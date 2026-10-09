// Records each bundled content/*.json in src/content/bundled.json: sha256 of its exact bytes, top-level schema_version
// and updated_at (committer date of the file's last commit, UTC: the same derivation as backend/scripts/content-updated-at.sh).
//
//   node scripts/content-meta.mjs           regenerate (run in a FULL-history checkout of main)
//   node scripts/content-meta.mjs --check   exit 1 if the committed file is stale; updated_at is compared only with full history
//
// Never falls back to the build time: on a shallow clone, or for a file with no commit, regeneration fails; --check then
// verifies the hashes and schema versions only and says that it skipped the dates.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, '../../../content');
const outFile = join(here, '../src/content/bundled.json');
const git = (...args) => execFileSync('git', ['-C', contentDir, ...args], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } }).trim();

const fullHistory = git('rev-parse', '--is-shallow-repository') === 'false';
const committed = (() => { try { return JSON.parse(readFileSync(outFile, 'utf8')); } catch { return {}; } })();
const check = process.argv.includes('--check');

const meta = {};
for (const file of readdirSync(contentDir).filter((f) => f.endsWith('.json')).sort()) {
  const name = file.slice(0, -5);
  const bytes = readFileSync(join(contentDir, file));
  let updated_at = committed[name]?.updated_at;
  if (fullHistory) {
    updated_at = git('log', '-1', '--date=format-local:%Y-%m-%dT%H:%M:%SZ', '--format=%cd', '--', file);
    if (!updated_at) { console.error(`no commit found for content/${file}`); process.exit(1); }
  } else if (!check) {
    console.error('shallow clone: updated_at needs full history (git fetch --unshallow)');
    process.exit(1);
  }
  meta[name] = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    schema_version: JSON.parse(bytes.toString('utf8')).schema_version,
    updated_at,
  };
}
const text = `${JSON.stringify(meta, null, 2)}\n`;
if (check) {
  if (!fullHistory) console.warn('shallow clone: updated_at not checked');
  const same = fullHistory
    ? text === readFileSync(outFile, 'utf8')
    : Object.keys({ ...meta, ...committed }).every((n) => meta[n] && committed[n] && meta[n].sha256 === committed[n].sha256 && meta[n].schema_version === committed[n].schema_version);
  if (!same) { console.error('src/content/bundled.json is stale: run `node scripts/content-meta.mjs` in a full-history checkout'); process.exit(1); }
} else {
  writeFileSync(outFile, text);
}
