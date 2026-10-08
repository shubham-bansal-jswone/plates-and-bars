// Usage: node validate/foods-cli.mjs [content/foods.json] [content/eatout.json]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFoods, validateEatOut } from './foods.mjs';

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

const eatPath = resolve(process.argv[3] ?? `${repo}/content/eatout.json`);
const eat = JSON.parse(readFileSync(eatPath, 'utf8'));
const eatErrors = validateEatOut(eat);
if (eatErrors.length) {
  console.error(eatErrors.join('\n'));
  console.error(`${eatErrors.length} problem(s) in ${eatPath}`);
  process.exit(1);
}
console.log(`eatout ok: ${eat.cuisines.length} cuisines, ${eat.cuisines.reduce((n, c) => n + c.dishes.length, 0)} dishes`);
