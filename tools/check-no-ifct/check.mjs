// Fails if "IFCT", "INDB" or their spelled-out names (any case) appears anywhere under a scanned folder: in file names or contents.
// The acronyms match as whole words (IFCT2017 and ifct_x match; "findByText" does not).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = /(?<![a-z])(?:ifct|indb)(?![a-z])|indian food composition tables?|indian nutrient data ?bank/i;

/**
 * What ships to users or seeds data, relative to the repo root: content, the app's bundled content, the e2e seed data and the
 * backend's resources (migrations, config, test goldens). Policy docs (ADRs, specs say "no IFCT"), agent prompts and the scanner's
 * own negative fixtures are deliberately not listed. Keep in step with the tools path filter in infra/scripts/detect-changes.sh.
 */
export const SCAN_ROOTS = ['content', 'apps/mobile/src/content', 'tests/e2e/store', 'backend/src/main/resources', 'backend/src/test/resources'];
const SKIP_DIRS = new Set(['node_modules', 'build', '.gradle']);

/** @returns {string[]} one message per offending file name or line */
export function scanContent(dir) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(d, name);
      const rel = relative(dir, p);
      if (BANNED.test(name)) hits.push(`${rel}: file name`);
      if (statSync(p).isDirectory()) walk(p);
      else readFileSync(p, 'latin1').split('\n').forEach((line, i) => {
        const m = BANNED.exec(line);
        if (m) hits.push(`${rel}:${i + 1}: "${m[0]}"`);
      });
    }
  };
  walk(dir);
  return hits;
}

/** Scans every SCAN_ROOTS folder that exists under the repo root; hits are prefixed with the folder. */
export function scanRepo(repo) {
  return SCAN_ROOTS.filter((r) => existsSync(join(repo, r))).flatMap((r) => scanContent(join(repo, r)).map((h) => `${r}/${h}`));
}
