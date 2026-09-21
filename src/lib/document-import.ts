import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type Progress = (message: string) => void;
type PdfText = { str: string; transform: number[]; width: number };

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

async function preparedImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('Изображение слишком большое. Используй фото до 40 мегапикселей.');
    }
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('На этом устройстве не удалось подготовить изображение.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить изображение.')), 'image/png'));
  } finally {
    bitmap.close();
  }
}

function pdfLines(items: unknown[]): string {
  const words = items.filter((item): item is PdfText => Boolean(item && typeof item === 'object' &&
    'str' in item && typeof item.str === 'string' && 'transform' in item && Array.isArray(item.transform) &&
    'width' in item && typeof item.width === 'number'))
    .filter(item => item.str.trim())
    .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: typeof words[] = [];
  for (const word of words) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y - word.y) <= 3) row.push(word);
    else rows.push([word]);
  }
  return rows.map(row => {
    row.sort((a, b) => a.x - b.x);
    let text = '', end = 0;
    for (const item of row) {
      if (text) text += item.x - end > 18 ? '\t' : ' ';
      text += item.text;
      end = item.x + item.width;
    }
    return text;
  }).join('\n');
}

export async function extractDocumentText(file: File, progress: Progress): Promise<string> {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const isImage = /\.(png|jpe?g|webp)$/i.test(file.name) || ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  if (!isPdf && !isImage) throw new Error('Выбери PDF, PNG, JPG или WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ. Выбери меньший файл или разбей PDF на части.');
  if (file.size === 0) throw new Error('Файл пуст.');

  let recognition: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null;
  let rejectWorker: (reason: Error) => void = () => {};
  const workerFailed = new Promise<never>((_, reject) => { rejectWorker = reject; });
  void workerFailed.catch(() => {});
  const recognise = async (image: Blob): Promise<string> => {
    if (!recognition) {
      progress('Загружаем распознавание английского и русского…');
      const { createWorker } = await import('tesseract.js');
      const assets = new URL('/ocr/', window.location.origin).href;
      const creating = createWorker(['eng', 'rus'], 1, {
        workerPath: `${assets}worker.min.js`,
        workerBlobURL: false,
        corePath: `${assets}core`,
        langPath: `${assets}lang`,
        gzip: false,
        errorHandler: reason => rejectWorker(reason instanceof Error ? reason : new Error(String(reason))),
        logger: message => {
          if (message.status === 'recognizing text') progress(`Распознаём слова: ${Math.round(message.progress * 100)}%`);
        },
      });
      recognition = await withTimeout(Promise.race([creating, workerFailed]), 90_000, 'Распознавание не запустилось за 90 секунд. Проверь соединение или попробуй другой файл.');
    }
    const result = await withTimeout(Promise.race([recognition.recognize(image), workerFailed]), 120_000, 'Распознавание заняло больше двух минут. Попробуй более чёткое или меньшее изображение.');
    return result.data.text.trim();
  };

  try {
    if (isImage) {
      progress('Распознаём слова на изображении…');
      const text = await recognise(await preparedImage(file));
      if (!text) throw new Error('Не удалось найти текст. Попробуй более чёткое фото или вставь слова вручную.');
      return text;
    }
    progress('Читаем PDF…');
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 8) throw new Error('Сейчас можно загрузить PDF до 8 страниц. Раздели большой файл на части.');
      const pages: string[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        progress(`Читаем страницу ${number} из ${pdf.numPages}…`);
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        let pageText = pdfLines(content.items);
        if (!pageText.trim()) {
          progress(`Распознаём скан: страница ${number} из ${pdf.numPages}…`);
          const viewport = page.getViewport({ scale: Math.min(2, 1800 / page.getViewport({ scale: 1 }).width) });
          if (viewport.width * viewport.height > 9_000_000) throw new Error('Страница PDF слишком большая для распознавания на устройстве.');
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('На этом устройстве не удалось открыть изображение страницы.');
          await page.render({ canvasContext: context, canvas, viewport }).promise;
          const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось обработать страницу PDF.')), 'image/png'));
          pageText = await recognise(image);
          canvas.width = canvas.height = 0;
        }
        if (pageText.trim()) pages.push(pageText.trim());
        page.cleanup();
      }
      if (!pages.length) throw new Error('В PDF не удалось найти слова. Попробуй другой файл или вставь текст вручную.');
      return pages.join('\n');
    } finally {
      await task.destroy();
    }
  } finally {
    const worker = recognition as Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null;
    if (worker) await worker.terminate();
  }
}
