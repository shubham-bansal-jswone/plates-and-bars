import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const pinned = JSON.parse(readFileSync(resolve(here, 'fixtures', 'content-ids.json'), 'utf8'));

// Saved user records point at these ids, so none may change or go; a new row needs the fixture updated in the same PR.
export function assertIds(rows, expected, label) {
  const now = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  assert.deepEqual(now, expected, `${label}: content ids differ from tools/test/fixtures/content-ids.json`);
}
