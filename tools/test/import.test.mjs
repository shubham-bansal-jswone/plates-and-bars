import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandCard, expandTags, importExercises, serialize } from '../exercises-import/import.mjs';

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

test('expandCard maps short keys to long names and keeps optional ones optional', () => {
  const base = { f: 'Chest', s: ['a'], c: ['b'], m: ['c'], w: [['l', 'fix']] };
  assert.deepEqual(expandCard(base), {
    where_to_feel: 'Chest', setup: ['a'], key_cues: ['b'], common_mistakes: ['c'], misplaced_feel: [['l', 'fix']],
  });
  assert.deepEqual(expandCard({ ...base, b: 'x', e: 'y', h: 'z' }), {
    where_to_feel: 'Chest', setup: ['a'], key_cues: ['b'], common_mistakes: ['c'], misplaced_feel: [['l', 'fix']],
    breathing: 'x', easier_version: 'y', harder_version: 'z',
  });
});

test('expandCard rejects missing required and unknown fields', () => {
  assert.throws(() => expandCard({ f: 'x', s: [], c: [], m: [] }), /"w" missing/);
  assert.throws(() => expandCard({ f: 'x', s: [], c: [], m: [], w: [], z: 1 }), /unknown/);
});

test('every golden card expands with the same values under long names', () => {
  const out = importExercises(golden);
  assert.deepEqual(Object.keys(out.cards), Object.keys(golden.cards));
  const g = golden.cards['Barbell Bench Press'];
  const c = out.cards['Barbell Bench Press'];
  assert.equal(c.where_to_feel, g.f);
  assert.deepEqual(c.misplaced_feel, g.w);
  assert.equal(c.breathing, g.b);
});
