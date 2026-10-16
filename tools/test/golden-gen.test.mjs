import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAll } from '../golden-gen/generate.mjs';
import * as cases from '../golden-gen/cases.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');
const golden = (f) => readFileSync(`${repo}/docs/spec/golden/${f}`, 'utf8');
const cli = resolve(repo, 'tools/golden-gen/cli.mjs');

test('the generator reproduces every committed golden file byte for byte (drift check, #99)', () => {
  const out = generateAll(html);
  assert.deepEqual(Object.keys(out).sort(), readdirSync(`${repo}/docs/spec/golden`).filter((f) => f.endsWith('.json')).sort());
  for (const [f, text] of Object.entries(out)) assert.equal(text, golden(f), `${f} differs from the prototype; regenerate in a spec-change PR`);
});

test('generation is deterministic and independent of the time zone', () => {
  assert.deepEqual(generateAll(html), generateAll(html));
  const run = (tz) => spawnSync(process.execPath, [cli, '--check'], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles']) assert.equal(run(tz).status, 0, tz);
});

test('the case list records the inputs behind every computed fixture', () => {
  const g = (f) => JSON.parse(golden(f));
  assert.deepEqual(g('targets.json').map((c) => c.input), cases.TARGETS);
  assert.deepEqual(g('progression.json').cases.map((c) => c.input), cases.PROGRESSION);
  assert.deepEqual(g('plan.json').plans.map((p) => p.days), cases.PLAN_DAYS);
  assert.deepEqual(g('plan.json').cases.map((c) => [c.id, c.input.days, c.input.mode, c.input.weekPlan, c.input.sessions]), cases.PLAN_CASES.map((c) => [c.id, c.days, c.mode, c.weekPlan, c.sessions]));
  assert.equal(g('sessions.json').length, cases.SESSION_WHERE.length * cases.SESSION_TEMPLATES.length * cases.SESSION_FOCUS.length + cases.SESSION_EXTRA.length);
  assert.ok(g('sessions.json').every((c) => c.input.minutes && c.input.exp && c.input.history >= 0), 'every sessions case records its profile');
  assert.equal(g('learn.json').cases.length, cases.LEARN_SEX.length * cases.LEARN_DAYS.length * Object.keys(cases.LEARN_READ).length);
});

test('a prototype change that alters a fixture value is detected as drift', () => {
  const changed = html.replace("['Roti / chapati','1 medium (30 g atta)',102,", "['Roti / chapati','1 medium (30 g atta)',103,");
  assert.notEqual(changed, html);
  assert.notEqual(generateAll(changed)['foods.json'], golden('foods.json'));
  const dir = mkdtempSync(join(tmpdir(), 'golden-gen-'));
  try {
    const proto = join(dir, 'proto.html');
    writeFileSync(proto, changed);
    const r = spawnSync(process.execPath, [cli, '--check', '--prototype', proto], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /foods\.json/);
    assert.doesNotMatch(r.stderr, /targets\.json/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--out writes the files and --check on that directory passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'golden-gen-'));
  try {
    assert.equal(spawnSync(process.execPath, [cli, '--out', dir], { encoding: 'utf8' }).status, 0);
    for (const f of readdirSync(dir)) assert.equal(readFileSync(join(dir, f), 'utf8'), golden(f));
    assert.equal(spawnSync(process.execPath, [cli, '--check', '--out', dir], { encoding: 'utf8' }).status, 0);
    writeFileSync(join(dir, 'targets.json'), '[]');
    assert.equal(spawnSync(process.execPath, [cli, '--check', '--out', dir], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
