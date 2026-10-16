import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nonEmpty } from '../validate/text.mjs';
import { validateCards } from '../validate/cards.mjs';
import { validateFoods } from '../validate/foods.mjs';
import { validateRecipes } from '../validate/recipes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(resolve(here, '../../packages/api/test-vectors/blank-text.json'), 'utf8'));

test('blank-text vectors: must_fail texts are rejected', () => {
  assert.ok(vectors.must_fail.length > 0);
  for (const t of vectors.must_fail) assert.equal(nonEmpty(t), false, JSON.stringify(t));
});

test('blank-text vectors: must_pass texts are accepted', () => {
  assert.ok(vectors.must_pass.length > 0);
  for (const t of vectors.must_pass) assert.equal(nonEmpty(t), true, JSON.stringify(t));
});

test('non-strings are not text', () => {
  for (const v of [null, undefined, 0, [], {}]) assert.equal(nonEmpty(v), false);
});

test('shared pattern matches the helper', () => {
  for (const t of [...vectors.must_fail, ...vectors.must_pass]) assert.equal(nonEmpty(t), new RegExp(vectors.pattern).test(t));
});

// Each validator must use the shared helper: a zero-width-only required field is rejected.
const ZW = '​';
const content = (f) => JSON.parse(readFileSync(resolve(here, '../../content', f), 'utf8'));

test('validateCards rejects a zero-width-only title', () => {
  const c = content('cards.json');
  c.cards[0].title = ZW;
  assert.ok(validateCards(c).some((e) => e.includes('title missing')));
});

test('validateFoods rejects a zero-width-only name', () => {
  const c = content('foods.json');
  c.foods[0].name = ZW;
  assert.ok(validateFoods(c).some((e) => e.includes('name must be a non-empty string')));
});

test('validateRecipes rejects a zero-width-only step', () => {
  const c = content('recipes.json');
  c.library[0].steps[0] = ZW;
  assert.ok(validateRecipes(c, new Set()).some((e) => e.includes('steps must be a non-empty array')));
});
