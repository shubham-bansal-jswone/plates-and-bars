// Usage: node validate/recipes-cli.mjs [content dir]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRaw, validateRecipes, validatePlanning } from './recipes.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? `${repo}/content`);
const load = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const raw = load('raw-ingredients.json');
const recipes = load('recipes.json');
const planning = load('meal-planning.json');
const foodNames = new Set(load('foods.json').foods.map((f) => f.name));

const errors = [
  ...validateRaw(raw).map((e) => `raw-ingredients.json: ${e}`),
  ...validateRecipes(recipes, new Set(raw.ingredients.map((i) => i.name))).map((e) => `recipes.json: ${e}`),
  ...validatePlanning(planning, foodNames).map((e) => `meal-planning.json: ${e}`),
];
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`recipes ok: ${raw.ingredients.length} raw ingredients, ${recipes.library.length} library recipes, ${recipes.presets.length} presets, ${planning.grocery.length} grocery entries`);
