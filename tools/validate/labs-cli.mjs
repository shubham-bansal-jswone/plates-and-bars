// Usage: node validate/labs-cli.mjs [content-dir]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLabs } from './labs.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? `${repo}/content`);
const errors = validateLabs(JSON.parse(readFileSync(`${dir}/labs.json`, 'utf8')));
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s) in labs.json`);
  process.exit(1);
}
console.log('labs.json ok');
