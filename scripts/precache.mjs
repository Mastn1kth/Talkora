import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = new URL('../dist/', import.meta.url);
const assets = await readdir(new URL('assets/', directory));
const precache = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', ...assets.filter(name => /\.(js|mjs|css|woff2|png|svg|webp)$/.test(name)).map(name => `/assets/${name}`)];
const file = new URL('sw.js', directory);
const worker = await readFile(file, 'utf8');
if (!worker.includes('__TALKORA_ASSETS__')) throw new Error('Service worker precache placeholder not found.');
await writeFile(file, worker.replace('__TALKORA_ASSETS__', JSON.stringify(precache)), 'utf8');
