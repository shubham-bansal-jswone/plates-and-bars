// Usage: node validate/import-aliases-cli.mjs [content dir]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateImportAliases } from './import-aliases.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? `${repo}/content`);
const load = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const content = load('import-aliases.json');
const errors = validateImportAliases(content, Object.keys(load('exercises.json').tags));
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s) in import-aliases.json`);
  process.exit(1);
}
console.log(`import-aliases ok: ${Object.keys(content.aliases).length} aliases`);
