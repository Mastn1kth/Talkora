export interface ImportedWord { english: string; russian: string }

export class WordImportError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Строка ${line}: ${message}`);
    this.name = 'WordImportError';
    this.line = line;
  }
}

/** Split records first, keeping quoted newlines inside a single CSV record. */
function records(text: string): { value: string; line: number }[] {
  const result: { value: string; line: number }[] = [];
  let value = '', quoted = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '""'; i++; continue; }
      quoted = !quoted;
    }
    if (char === '\n') {
      if (!quoted) { result.push({ value, line: start }); value = ''; start = line + 1; }
      else value += char;
      line++;
    } else value += char;
  }
  if (quoted) throw new WordImportError('не закрыты кавычки. Проверьте CSV перед импортом.', start);
  if (value.trim()) result.push({ value, line: start });
  return result;
}

function detectDelimiter(value: string): string | undefined {
  let quoted = false;
  const found = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') {
      if (quoted && value[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (['\t', ';', ','].includes(value[i])) found.add(value[i]);
      if (/[—–-]/.test(value[i]) && /\s/.test(value[i - 1] ?? '') && /\s/.test(value[i + 1] ?? '')) found.add(` ${value[i]} `);
    }
  }
  return ['\t', ';', ' — ', ' – ', ' - ', ','].find(delimiter => found.has(delimiter));
}

function fields(value: string, delimiter: string, line: number): string[] {
  const result: string[] = [];
  let field = '', quoted = false, closed = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (quoted && value[i + 1] === '"') { field += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!field.trim() && !closed) { quoted = true; field = ''; }
      else throw new WordImportError('кавычки должны обрамлять поле целиком.', line);
    } else if (value.startsWith(delimiter, i) && !quoted) {
      result.push(field.trim()); field = ''; closed = false; i += delimiter.length - 1;
    } else if (closed && char.trim()) throw new WordImportError('лишний текст после закрывающей кавычки.', line);
    else field += char;
  }
  result.push(field.trim());
  return result;
}

/** Input is treated only as text: no formula evaluation, HTML rendering or network requests. */
export function parseWordText(text: string, options: { allowMissingTranslation?: boolean } = {}): ImportedWord[] {
  if (text.length > 1_000_000) throw new WordImportError('слишком большой текст. Максимум — 1 млн символов и 500 слов за один импорт.', 1);
  const rows = records(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  const result: ImportedWord[] = [];
  const seen = new Set<string>();
  let entryCount = 0;
  for (const row of rows) {
    const value = row.value.trim();
    if (!value) continue;
    const delimiter = detectDelimiter(value);
    const parts = delimiter ? fields(value, delimiter, row.line) : value.split(/\s+[—–-]\s+/);
    if (parts.length === 1 && options.allowMissingTranslation) parts.push('');
    if (parts.length !== 2) throw new WordImportError('нужны два столбца: английское слово и перевод. Используйте табуляцию, «;», «,» или « — ». Поля с запятыми заключите в кавычки.', row.line);
    const [english, russian] = parts.map(part => part.trim().replace(/\s+/g, ' '));
    if (options.allowMissingTranslation && result.length === 0 && /^(english|en|word|слово|английский)$/i.test(english) && !russian) continue;
    if (result.length === 0 && /^(english|en|word|слово|английский)$/i.test(english) && /^(russian|ru|translation|перевод|русский)$/i.test(russian)) continue;
    if (!english || (!russian && !options.allowMissingTranslation)) throw new WordImportError('не хватает слова или перевода. Добавьте перевод и проверьте список перед сохранением.', row.line);
    if (english.length > 300 || russian.length > 500) throw new WordImportError('слишком длинная запись. Используйте слова, выражения или короткие предложения.', row.line);
    entryCount++;
    if (entryCount > 500) throw new WordImportError('за один раз можно добавить не более 500 записей.', row.line);
    const key = `${english.toLocaleLowerCase('en-GB')}\u0000${russian.toLocaleLowerCase('ru-RU')}`;
    if (!seen.has(key)) { result.push({ english, russian }); seen.add(key); }
  }
  if (!result.length) throw new WordImportError('список пуст. Добавьте хотя бы одно слово.', 1);
  return result;
}
