// Fails if "IFCT" or "INDB" (any case) appears anywhere under a content folder: in file names or contents.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = /ifct|indb/i;

/** @returns {string[]} one message per offending file name or line */
export function scanContent(dir) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
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
