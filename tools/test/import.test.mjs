import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandTags, importExercises, serialize } from '../exercises-import/import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const golden = JSON.parse(readFileSync(`${repo}/docs/spec/golden/exercises.json`, 'utf8'));

test('expandTags maps short names to contract names', () => {
  assert.deepEqual(
    expandTags({ p: 'h-press', f: 'bench', eq: 'barbell', d: 3, m: ['chest'], s: ['triceps'], j: ['elbow'] }),
    { pattern: 'h-press', family: 'bench', equipment: 'barbell', difficulty: 3,
      primary: ['chest'], secondary: ['triceps'], joints: ['elbow'] },
  );
});

test('expandTags rejects missing and unknown fields', () => {
  assert.throws(() => expandTags({ p: 'x' }), /missing/);
  assert.throws(
    () => expandTags({ p: 'x', f: 'x', eq: 'x', d: 1, m: [], s: [], j: [], z: 1 }),
    /unknown/,
  );
});

test('import preserves ladders, away map, cards and library untouched', () => {
  const out = importExercises(golden);
  assert.deepEqual(out.ladders, golden.ladders);
  assert.deepEqual(out.away_map.dumbbells_bodyweight, golden.awayMap_dumbbells_bodyweight);
  assert.deepEqual(out.cards, golden.cards);
  assert.deepEqual(out.library, golden.library);
  assert.deepEqual(Object.keys(out.tags), Object.keys(golden.tags));
  assert.equal(out.tags['Barbell Bench Press'].pattern, 'h-press');
  assert.equal(out.tags['Barbell Bench Press'].primary[0], 'chest');
});

test('import is deterministic', () => {
  assert.equal(serialize(importExercises(golden)), serialize(importExercises(structuredClone(golden))));
});

test('content/exercises.json equals a fresh import of the golden file', () => {
  const committed = readFileSync(`${repo}/content/exercises.json`, 'utf8');
  assert.equal(committed, serialize(importExercises(golden)));
});
