// Fails if "IFCT", "INDB" or their spelled-out names (any case) appears anywhere under a scanned folder: in file names or contents.
// IFCT matches in any case and inside any token (IFCTdata, fromIFCT). INDB matches as upper case anywhere (myINDBdata) or as
// Indb/indb not glued to a letter before it (indbExport), so findByText, findbugs, windbreak and blindbox pass.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const ANY_CASE = /ifct|indian food composition tables?|indian nutrient data ?bank/i;
const EXACT = /INDB|(?<![A-Za-z])[Ii]ndb/;
const banned = (text) => ANY_CASE.exec(text)?.[0] ?? EXACT.exec(text)?.[0] ?? null;

/**
 * What ships to users or seeds data, relative to the repo root: content, the app's bundled content, the e2e seed data and the
 * backend's resources (migrations, config, test goldens), the About attribution list and the website source. Policy docs (ADRs, specs say "no IFCT"), agent prompts and the scanner's
 * own negative fixtures are deliberately not listed. Keep in step with the tools path filter in infra/scripts/detect-changes.sh.
 */
export const SCAN_ROOTS = [
  'content', 'apps/mobile/src/content', 'apps/mobile/src/about/licences.json', 'apps/site/src', 'tests/e2e/store',
  'backend/src/main/resources', 'backend/src/test/resources',
];
/** Only dependency and build output; never a folder that holds data (a test pins this list). */
export const SKIP_DIRS = new Set(['node_modules', 'build', '.gradle']);

/** @returns {string[]} one message per offending file name or line; `dir` may also be a single file */
export function scanContent(dir) {
  const hits = [];
  const scanFile = (p, rel) => readFileSync(p, 'latin1').split('\n').forEach((line, i) => {
    const m = banned(line);
    if (m) hits.push(`${rel}:${i + 1}: "${m}"`);
  });
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(d, name);
      const rel = relative(dir, p);
      if (banned(name)) hits.push(`${rel}: file name`);
      if (statSync(p).isDirectory()) walk(p);
      else scanFile(p, rel);
    }
  };
  if (!existsSync(dir)) return [`${dir}: scan root missing`];
  if (statSync(dir).isDirectory()) walk(dir);
  else scanFile(dir, basename(dir));
  return hits;
}

/** Scans every SCAN_ROOTS entry under the repo root (a missing one is a hit); hits are prefixed with the folder. */
export function scanRepo(repo) {
  return SCAN_ROOTS.flatMap((r) => {
    const p = join(repo, r);
    if (!existsSync(p)) return [`${r}: scan root missing`]; // a moved or renamed folder must not silently stop being scanned
    return scanContent(p).map((h) => (statSync(p).isDirectory() ? `${r}/${h}` : `${dirname(r)}/${h}`));
  });
}
