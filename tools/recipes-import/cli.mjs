// Usage: node recipes-import/cli.mjs [prototype.html] [content dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAll, serialize } from './import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(process.argv[2] ?? `${repo}/docs/prototype/plate-and-bar.html`);
const dir = resolve(process.argv[3] ?? `${repo}/content`);
const out = importAll(readFileSync(src, 'utf8'));
writeFileSync(`${dir}/raw-ingredients.json`, serialize(out.raw));
writeFileSync(`${dir}/recipes.json`, serialize(out.recipes));
writeFileSync(`${dir}/meal-planning.json`, serialize(out.planning));
console.log(`wrote ${dir}: ${out.raw.ingredients.length} raw ingredients, ${out.recipes.library.length} library recipes, ${out.recipes.presets.length} presets, ${out.planning.grocery.length} grocery entries`);
