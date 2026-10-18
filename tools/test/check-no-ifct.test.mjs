import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SCAN_ROOTS, SKIP_DIRS, scanContent, scanRepo } from '../check-no-ifct/check.mjs';

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
    if (f.endsWith('.json/ok.json')) continue; // a file root: written below

    mkdirSync(dirname(`${dir}/${f}`), { recursive: true });
    writeFileSync(`${dir}/${f}`, text);
  }
  for (const r of SCAN_ROOTS.filter((x) => x.endsWith('.json'))) {
    mkdirSync(dirname(`${dir}/${r}`), { recursive: true });
    writeFileSync(`${dir}/${r}`, plant[r] ?? '{}');
  }
  return dir;
}
const scanText = (text) => {
  const d = mkdtempSync(`${tmpdir()}/ifct-text-`);
  try {
    writeFileSync(`${d}/a.txt`, `${text}\n`);
    return scanContent(d);
  } finally { rmSync(d, { recursive: true }); }
};
const withRepo = (plant, fn) => { const d = fakeRepo(plant); try { fn(d); } finally { rmSync(d, { recursive: true }); } };

test('repo scan covers content, app content, seed data and backend resources', () => {
  assert.deepEqual(SCAN_ROOTS, [
    'content', 'apps/mobile/src/content', 'apps/mobile/src/about/licences.json', 'apps/site/src', 'tests/e2e/store',
    'backend/src/main/resources', 'backend/src/test/resources',
  ]);
});

const isFile = (root) => root.endsWith('.json');
for (const root of SCAN_ROOTS) {
  test(`planted mention under ${root} fails the repo scan`, () => {
    const file = isFile(root) ? root : `${root}/deep/x.sql`;
    withRepo({ [file]: '-- values from IFCT 2017\n' }, (d) => {
      assert.deepEqual(scanRepo(d), [`${file}:1: "IFCT"`]);
    });
  });
  if (!isFile(root)) {
    test(`planted file name under ${root} fails the repo scan`, () => {
      withRepo({ [`${root}/indb-export.json`]: '{}' }, (d) => {
        assert.deepEqual(scanRepo(d), [`${root}/indb-export.json: file name`]);
      });
    });
  }
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

test('tokens glued to letters still fail', () => {
  for (const word of ['IFCTdata', 'fromIFCT', 'indbExport', 'myINDBdata', 'IFCT2017', 'Indbfile']) {
    assert.equal(scanText(word).length, 1, word);
  }
});

test('ordinary words containing the letters pass', () => {
  for (const word of ['findByText', 'findbugs', 'windbreak', 'blindbox']) {
    assert.deepEqual(scanText(word), [], word);
  }
});

test('SKIP_DIRS lists only dependency and build output, and data folders are scanned', () => {
  assert.deepEqual([...SKIP_DIRS].sort(), ['.gradle', 'build', 'node_modules']);
  for (const dir of ['db', 'data', 'migration', 'seed', 'store', 'golden', 'resources']) {
    withRepo({ [`content/${dir}/x.json`]: 'IFCT' }, (d) => {
      assert.deepEqual(scanRepo(d), [`content/${dir}/x.json:1: "IFCT"`], dir);
    });
  }
});

test('a missing scan root fails (folder and file)', () => {
  for (const root of SCAN_ROOTS) {
    withRepo({}, (d) => {
      rmSync(`${d}/${root}`, { recursive: true });
      assert.deepEqual(scanRepo(d), [`${root}: scan root missing`], root);
    });
  }
});

test('a nonexistent path given to the CLI fails', () => {
  const r = run(`${here}/fixtures/no-such-folder`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^scan root missing: .*no-such-folder$/m);
  assert.doesNotMatch(r.stderr, /IFCT\/INDB found/);
});

test('shipped repo folders have no IFCT or INDB (the CI step)', () => {
  assert.deepEqual(scanRepo(repo), []);
  const r = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
