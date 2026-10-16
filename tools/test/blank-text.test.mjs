import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nonEmpty } from '../validate/text.mjs';

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
