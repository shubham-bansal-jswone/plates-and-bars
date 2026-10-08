// Dependency-free lint: every .mjs file must parse, and no tabs/trailing whitespace.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.mjs')) files.push(p);
  }
};
walk(root);

let failed = false;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed = true;
    console.error(r.stderr);
  }
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/\t|[ ]+$/.test(line)) {
      failed = true;
      console.error(`${f}:${i + 1}: tab or trailing whitespace`);
    }
  });
}
if (failed) process.exit(1);
console.log(`lint ok (${files.length} files)`);
