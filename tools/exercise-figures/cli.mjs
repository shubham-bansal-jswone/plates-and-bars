// Usage: node exercise-figures/cli.mjs [--check]
// Regenerates content/exercise-images.json from the rig; --check exits 1 if the committed file differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, serialize } from './generate.mjs';
import { validateExerciseImages } from '../validate/exercise-images.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const names = Object.keys(JSON.parse(readFileSync(`${repo}/content/exercises.json`, 'utf8')).tags);
const bundle = buildBundle(names);
const errors = validateExerciseImages(bundle, names);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const text = serialize(bundle);
const file = `${repo}/content/exercise-images.json`;
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== text) { console.error('content/exercise-images.json is stale: run `npm run import:figures` in tools/'); process.exit(1); }
  console.log('exercise figures up to date');
} else {
  writeFileSync(file, text);
  const sizes = Object.values(bundle.images).flatMap((i) => i.frames.map((f) => Buffer.byteLength(f.svg)));
  console.log(`${Object.keys(bundle.images).length} exercises, ${sizes.length} frames, ${Math.min(...sizes)} to ${Math.max(...sizes)} bytes each`);
}
