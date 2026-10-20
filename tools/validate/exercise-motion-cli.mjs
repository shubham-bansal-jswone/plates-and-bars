// Usage: node validate/exercise-motion-cli.mjs [content dir]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExerciseMotion } from './exercise-motion.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? `${repo}/content`);
const load = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const content = load('exercise-motion.json');
const errors = validateExerciseMotion(content, Object.keys(load('exercises.json').tags));
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`${errors.length} problem(s) in exercise-motion.json`);
  process.exit(1);
}
console.log(`exercise-motion ok: ${Object.keys(content.motions).length} exercises`);
