// Usage: node exercises-import/cli.mjs [golden.json] [out.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importExercises, serialize } from './import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(process.argv[2] ?? `${repo}/docs/spec/golden/exercises.json`);
const dst = resolve(process.argv[3] ?? `${repo}/content/exercises.json`);

const out = importExercises(JSON.parse(readFileSync(src, 'utf8')));
mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, serialize(out));
console.log(`wrote ${dst}: ${Object.keys(out.tags).length} exercises, ` +
  `${Object.keys(out.ladders).length} ladders, ${Object.keys(out.cards).length} cards`);
