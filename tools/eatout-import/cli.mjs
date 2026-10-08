// Usage: node eatout-import/cli.mjs [prototype.html] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importEatOut, serialize } from './import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = resolve(process.argv[2] ?? `${repo}/docs/prototype/plate-and-bar.html`);
const dst = resolve(process.argv[3] ?? `${repo}/content/eatout.json`);
const out = importEatOut(readFileSync(src, 'utf8'));
writeFileSync(dst, serialize(out));
console.log(`wrote ${dst}: ${out.cuisines.length} cuisines, ${out.cuisines.reduce((n, c) => n + c.dishes.length, 0)} dishes`);
