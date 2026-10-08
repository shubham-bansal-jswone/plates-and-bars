import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanContent } from '../check-no-ifct/check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const cli = resolve(here, '..', 'check-no-ifct', 'cli.mjs');
const run = (dir) => spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });

test('fixture mentioning IFCT or INDB (any case) fails with file and line', () => {
  const hits = scanContent(`${here}/fixtures/ifct-content`);
  assert.deepEqual(hits, ['foods.json:2: "IFCT"', 'other.json:2: "indb"']);
  const r = run(`${here}/fixtures/ifct-content`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /foods\.json:2/);
});

test('spelled-out names fail too', () => {
  assert.deepEqual(scanContent(`${here}/fixtures/ifct-names`), ['a.json:2: "Indian Food Composition Tables"', 'b.json:2: "indian nutrient databank"']);
  assert.equal(run(`${here}/fixtures/ifct-names`).status, 1);
});

test('clean fixture passes', () => {
  assert.deepEqual(scanContent(`${here}/fixtures/clean-content`), []);
  assert.equal(run(`${here}/fixtures/clean-content`).status, 0);
});

test('shipped content/ has no IFCT or INDB', () => {
  assert.deepEqual(scanContent(`${repo}/content`), []);
  assert.equal(run(`${repo}/content`).status, 0);
});
