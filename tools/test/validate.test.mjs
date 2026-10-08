import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExercises } from '../validate/exercises.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('shipped content passes against the golden templates', () => {
  const content = read(`${repo}/content/exercises.json`);
  const { templates } = read(`${repo}/docs/spec/golden/plan.json`);
  assert.deepEqual(validateExercises(content, templates), []);
});

test('broken fixture fails: template, ladder and away map exercises lacking tags or card', () => {
  const content = read(`${here}/fixtures/broken-exercises.json`);
  const templates = { 'Push A': ['Bench A', 'Ghost Lift'] };
  const errors = validateExercises(content, templates);
  assert.ok(errors.includes('Ghost Lift: no tags (used in template "Push A")'));
  assert.ok(errors.includes('Ghost Lift: no card (used in template "Push A")'));
  assert.ok(errors.includes('Bench B: no card (used in ladder "hpress")'));
  assert.ok(errors.includes('Floor Press: no tags (used in away map "dumbbells_bodyweight")'));
  assert.ok(errors.some((e) => e.includes('unknown muscle "pecs"')));
  assert.ok(errors.some((e) => e.includes('difficulty must be 1, 2 or 3')));
});

test('null away alternative is allowed', () => {
  const content = read(`${repo}/content/exercises.json`);
  content.away_map.dumbbells_bodyweight['Lateral Raise'] = ['Lateral Raise', null];
  assert.deepEqual(validateExercises(content, {}), []);
});

test('card missing "w" fails', () => {
  const content = read(`${repo}/content/exercises.json`);
  delete content.cards['Push-ups'].w;
  assert.ok(validateExercises(content, {}).includes('Push-ups: card "w" must be a non-empty array'));
});

test('broken library reference fails', () => {
  const content = read(`${repo}/content/exercises.json`);
  content.library.Chest.push('Nonexistent Press');
  const errors = validateExercises(content, {});
  assert.ok(errors.includes('Nonexistent Press: no tags (used in library "Chest")'));
  assert.ok(errors.includes('Nonexistent Press: no card (used in library "Chest")'));
});
