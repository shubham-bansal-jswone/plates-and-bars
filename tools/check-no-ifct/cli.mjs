// Usage: node check-no-ifct/cli.mjs [content-dir]   (default: content/ at the repo root)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanContent } from './check.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? `${repo}/content`);
const hits = scanContent(dir);
if (hits.length) {
  console.error(hits.join('\n'));
  console.error(`IFCT/INDB found in ${dir} (ADR 002 forbids it): ${hits.length} hit(s)`);
  process.exit(1);
}
console.log(`no IFCT/INDB under ${dir}`);
