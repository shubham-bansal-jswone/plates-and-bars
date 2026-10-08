// Usage: node validate/cli.mjs [content/exercises.json] [plan.json with "templates"]
// Also validates content/foods.json and scans content/ for IFCT/INDB, so one command checks all content.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExercises } from './exercises.mjs';
import { validateFoods } from './foods.mjs';
import { scanContent } from '../check-no-ifct/check.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contentPath = resolve(process.argv[2] ?? `${repo}/content/exercises.json`);
const planPath = resolve(process.argv[3] ?? `${repo}/docs/spec/golden/plan.json`);

const content = JSON.parse(readFileSync(contentPath, 'utf8'));
const { templates } = JSON.parse(readFileSync(planPath, 'utf8'));
const errors = validateExercises(content, templates);
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`exercises ok: ${Object.keys(content.tags).length} exercises, ` +
  `${Object.keys(templates).length} templates checked`);

const foods = JSON.parse(readFileSync(`${repo}/content/foods.json`, 'utf8'));
const problems = [
  ...validateFoods(foods),
  ...scanContent(`${repo}/content`).map((h) => `IFCT/INDB (ADR 005 forbids it): ${h}`),
];
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`foods ok: ${foods.foods.length} foods; no IFCT/INDB under content/`);
