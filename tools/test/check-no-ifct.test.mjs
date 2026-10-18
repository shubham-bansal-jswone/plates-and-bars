import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SCAN_ROOTS, scanContent, scanRepo } from '../check-no-ifct/check.mjs';

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

// A throwaway repo root with a clean file in every scanned folder; `plant` adds files.
function fakeRepo(plant = {}) {
  const dir = mkdtempSync(`${tmpdir()}/ifct-repo-`);
  const files = { ...Object.fromEntries(SCAN_ROOTS.map((r) => [`${r}/ok.json`, '{"source": "USDA"}'])), ...plant };
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(`${dir}/${f}`), { recursive: true });
    writeFileSync(`${dir}/${f}`, text);
  }
  return dir;
}
const withRepo = (plant, fn) => { const d = fakeRepo(plant); try { fn(d); } finally { rmSync(d, { recursive: true }); } };

test('repo scan covers content, app content, seed data and backend resources', () => {
  assert.deepEqual(SCAN_ROOTS, ['content', 'apps/mobile/src/content', 'tests/e2e/store', 'backend/src/main/resources', 'backend/src/test/resources']);
});

for (const root of SCAN_ROOTS) {
  test(`planted mention under ${root} fails the repo scan`, () => {
    withRepo({ [`${root}/deep/x.sql`]: '-- values from IFCT 2017\n' }, (d) => {
      assert.deepEqual(scanRepo(d), [`${root}/deep/x.sql:1: "IFCT"`]);
    });
  });
  test(`planted file name under ${root} fails the repo scan`, () => {
    withRepo({ [`${root}/indb-export.json`]: '{}' }, (d) => {
      assert.deepEqual(scanRepo(d), [`${root}/indb-export.json: file name`]);
    });
  });
}

test('policy docs, agent prompts and negative fixtures are not scanned', () => {
  withRepo({
    'docs/adr/005-food-data.md': 'No IFCT or INDB data anywhere.',
    'docs/spec/golden/foods.json': '{"notes": "no IFCT data"}',
    '.claude/agents/content.md': 'Absolutely no IFCT or INDB data.',
    '.opencode/agents/content.md': 'Absolutely no IFCT or INDB data.',
    'tools/test/fixtures/ifct-content/foods.json': '{"note": "Values from IFCT tables"}',
    'apps/mobile/__tests__/about.test.tsx': "expect(x).not.toMatch(/IFCT|INDB/i);",
  }, (d) => {
    assert.deepEqual(scanRepo(d), []);
  });
});

test('acronyms match as words: findByText does not, IFCT2017 does', () => {
  withRepo({ 'tests/e2e/store/a.json': 'await screen.findByText("x")', 'content/b.json': '"IFCT2017"' }, (d) => {
    assert.deepEqual(scanRepo(d), ['content/b.json:1: "IFCT"']);
  });
});

test('shipped repo folders have no IFCT or INDB (the CI step)', () => {
  assert.deepEqual(scanRepo(repo), []);
  const r = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
