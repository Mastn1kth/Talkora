import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const languageDirectory = resolve(root, 'public/ocr/lang');
await rm(languageDirectory, { recursive: true, force: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].flatMap(variant => [
    [`node_modules/tesseract.js-core/tesseract-core-${variant}.wasm.js`, `public/ocr/core/tesseract-core-${variant}.wasm.js`],
    [`node_modules/tesseract.js-core/tesseract-core-${variant}.wasm`, `public/ocr/core/tesseract-core-${variant}.wasm`],
  ]),
];

for (const [source, destination] of files) {
  const target = resolve(root, destination);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, source), target);
}

const unzip = promisify(gunzip);
await mkdir(languageDirectory, { recursive: true });
for (const language of ['eng', 'rus']) {
  const source = resolve(root, `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`);
  await writeFile(resolve(languageDirectory, `${language}.traineddata`), await unzip(await readFile(source)));
}
