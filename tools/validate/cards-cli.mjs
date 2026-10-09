// Usage: node validate/cards-cli.mjs [content-dir]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCards, validateLabels, validateMeasures } from './cards.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? `${repo}/content`);
let bad = 0;
for (const [file, fn] of [['cards.json', validateCards], ['measures.json', validateMeasures], ['labels.json', validateLabels]]) {
  const errors = fn(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')));
  if (errors.length) { console.error(errors.join('\n')); console.error(`${errors.length} problem(s) in ${file}`); bad++; }
  else console.log(`${file} ok`);
}
if (bad) process.exit(1);
