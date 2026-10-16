// Usage: node golden-gen/cli.mjs [--check] [--prototype file.html] [--out dir]
//   (no flag)  regenerate docs/spec/golden/*.json from docs/prototype/plate-and-bar.html
//   --check    write nothing; exit 1 and list every file that differs from what the prototype produces
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAll } from './generate.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? resolve(args[i + 1]) : dflt; };
const check = args.includes('--check');
const html = readFileSync(opt('--prototype', `${repo}/docs/prototype/plate-and-bar.html`), 'utf8');
const outDir = opt('--out', `${repo}/docs/spec/golden`);

const files = generateAll(html);
if (check) {
  const stale = Object.entries(files).filter(([f, text]) => {
    try { return readFileSync(`${outDir}/${f}`, 'utf8') !== text; } catch { return true; }
  }).map(([f]) => f);
  if (stale.length) {
    console.error(`golden fixtures differ from the prototype: ${stale.join(', ')}\nRegenerate with "node golden-gen/cli.mjs" in a spec-change PR (docs/spec/golden is never edited by hand).`);
    process.exit(1);
  }
  console.log(`golden fixtures ok: ${Object.keys(files).length} files match the prototype`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(`${outDir}/${f}`, text);
  console.log(`wrote ${Object.keys(files).length} files to ${outDir}`);
}
