// Usage: node check-no-ifct/cli.mjs [dir]
// No argument: scans every folder in SCAN_ROOTS (content, app content, seed data, backend resources) at the repo root.
// With a dir: scans just that folder.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanContent, scanRepo } from './check.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = process.argv[2] ? resolve(process.argv[2]) : null;
const hits = target ? scanContent(target) : scanRepo(repo);
const where = target ?? 'the shipped folders';
if (hits.length) {
  console.error(hits.join('\n'));
  console.error(`IFCT/INDB found in ${where} (ADR 005 forbids it): ${hits.length} hit(s)`);
  process.exit(1);
}
console.log(`no IFCT/INDB under ${where}`);
