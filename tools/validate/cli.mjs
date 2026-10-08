// Usage: node validate/cli.mjs [content/exercises.json] [plan.json with "templates"]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExercises } from './exercises.mjs';

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
