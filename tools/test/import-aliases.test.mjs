import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateImportAliases } from '../validate/import-aliases.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (f) => JSON.parse(readFileSync(`${repo}/content/${f}`, 'utf8'));
const names = Object.keys(load('exercises.json').tags);
const good = () => ({ schema_version: 1, aliases: { 'Squat (Barbell)': 'Barbell Back Squat' } });

test('the shipped aliases are valid and every target is a library exercise', () => {
  const shipped = load('import-aliases.json');
  assert.deepEqual(validateImportAliases(shipped, names), []);
  assert.ok(Object.keys(shipped.aliases).length >= 8);
  assert.deepEqual(validateImportAliases(good(), names), []);
});

test('rejects bad shapes, unknown targets, library names as aliases and case duplicates', () => {
  assert.deepEqual(validateImportAliases([], names), ['bundle must be an object']);
  assert.match(validateImportAliases({ ...good(), schema_version: 2 }, names).join(), /schema_version/);
  assert.match(validateImportAliases({ ...good(), extra: 1 }, names).join(), /unknown top-level field "extra"/);
  assert.match(validateImportAliases({ ...good(), note: ' ' }, names).join(), /note/);
  assert.match(validateImportAliases({ schema_version: 1 }, names).join(), /aliases must be an object/);
  assert.match(validateImportAliases({ schema_version: 1, aliases: { 'Squat (Barbell)': 'Invented Squat' } }, names).join(), /not an exercise/);
  assert.match(validateImportAliases({ schema_version: 1, aliases: { 'Squat (Barbell)': 5 } }, names).join(), /not an exercise/);
  assert.match(validateImportAliases({ schema_version: 1, aliases: { 'Leg Press': 'Leg Press' } }, names).join(), /already a library exercise/);
  assert.match(validateImportAliases({ schema_version: 1, aliases: { ' X (Barbell)': 'Deadlift' } }, names).join(), /trimmed/);
  assert.match(validateImportAliases({ schema_version: 1, aliases: { 'X (Barbell)': 'Deadlift', 'x (barbell)': 'Deadlift' } }, names).join(), /duplicates/);
});

test('the command line passes on the repository content', () => {
  const r = spawnSync(process.execPath, [`${repo}/tools/validate/import-aliases-cli.mjs`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /import-aliases ok/);
});
