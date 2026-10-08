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

test('card missing "misplaced_feel" fails', () => {
  const content = read(`${repo}/content/exercises.json`);
  delete content.cards['Push-ups'].misplaced_feel;
  assert.ok(validateExercises(content, {}).includes('Push-ups: card "misplaced_feel" must be a non-empty array'));
});

test('card missing any required field fails', () => {
  for (const f of ['where_to_feel', 'setup', 'key_cues', 'common_mistakes', 'misplaced_feel']) {
    const content = read(`${repo}/content/exercises.json`);
    delete content.cards['Push-ups'][f];
    assert.ok(validateExercises(content, {}).some((e) => e.startsWith(`Push-ups: card "${f}"`)), f);
  }
});

test('optional card fields may be absent but must be strings when present', () => {
  const content = read(`${repo}/content/exercises.json`);
  const card = content.cards['Push-ups'];
  for (const f of ['breathing', 'easier_version', 'harder_version']) delete card[f];
  assert.deepEqual(validateExercises(content, {}), []);
  card.breathing = 5;
  card.easier_version = ['x'];
  const errors = validateExercises(content, {});
  assert.ok(errors.includes('Push-ups: card "breathing" must be a string'));
  assert.ok(errors.includes('Push-ups: card "easier_version" must be a string'));
});

test('old one-letter card keys are rejected', () => {
  const content = read(`${repo}/content/exercises.json`);
  content.cards['Push-ups'].f = 'x';
  const errors = validateExercises(content, {});
  assert.ok(errors.includes('Push-ups: unknown card field "f"'));
});

test('misplaced_feel entries must be [label, fix] pairs', () => {
  const content = read(`${repo}/content/exercises.json`);
  content.cards['Push-ups'].misplaced_feel = [['only label']];
  assert.ok(validateExercises(content, {}).includes('Push-ups: card "misplaced_feel" entries must be [label, fix] string pairs'));
});

test('broken library reference fails', () => {
  const content = read(`${repo}/content/exercises.json`);
  content.library.Chest.push('Nonexistent Press');
  const errors = validateExercises(content, {});
  assert.ok(errors.includes('Nonexistent Press: no tags (used in library "Chest")'));
  assert.ok(errors.includes('Nonexistent Press: no card (used in library "Chest")'));
});

test('non-string entries in setup, key_cues and common_mistakes fail', () => {
  for (const f of ['setup', 'key_cues', 'common_mistakes']) {
    const content = read(`${repo}/content/exercises.json`);
    content.cards['Push-ups'][f].push(false);
    assert.ok(validateExercises(content, {}).includes(`Push-ups: card "${f}" entries must be strings`), f);
  }
});
