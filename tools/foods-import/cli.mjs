// Usage: node foods-import/cli.mjs [golden.json] [out.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importFoods, serialize, HELD_BACK } from './import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(process.argv[2] ?? `${repo}/docs/spec/golden/foods.json`);
const dst = resolve(process.argv[3] ?? `${repo}/content/foods.json`);

const out = importFoods(JSON.parse(readFileSync(src, 'utf8')));
mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, serialize(out));
const counts = {};
for (const f of out.foods) counts[f.source.code] = (counts[f.source.code] ?? 0) + 1;
console.log(`wrote ${dst}: ${out.foods.length} foods ${JSON.stringify(counts)}; held back (source unknown): ${HELD_BACK.join(', ')}`);
