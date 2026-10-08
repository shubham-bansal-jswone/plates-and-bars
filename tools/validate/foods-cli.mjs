// Usage: node validate/foods-cli.mjs [content/foods.json]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFoods } from './foods.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const path = resolve(process.argv[2] ?? `${repo}/content/foods.json`);
const content = JSON.parse(readFileSync(path, 'utf8'));
const errors = validateFoods(content);
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`foods ok: ${content.foods.length} foods`);
