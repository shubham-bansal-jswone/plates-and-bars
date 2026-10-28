import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB_MARKER_KEYS, validateLabs } from '../validate/labs.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const labs = () => JSON.parse(readFileSync(`${repo}/content/labs.json`, 'utf8'));

test('content/labs.json validates', () => assert.deepEqual(validateLabs(labs()), []));

test('labs.json has the 14 markers in order', () => assert.deepEqual(Object.keys(labs().markers), LAB_MARKER_KEYS));

test('rejects a missing marker, an empty tip, an unknown side and a missing not-medical-advice line', () => {
  const bad = (f) => { const c = labs(); f(c); return validateLabs(c); };
  assert.match(bad((c) => delete c.markers.tsh).join(), /marker 'tsh' missing/);
  assert.match(bad((c) => (c.markers.hdl.low = '  ')).join(), /hdl.*low tip is empty/);
  assert.match(bad((c) => (c.markers.hdl.mid = 'x')).join(), /side 'mid'/);
  assert.match(bad((c) => (c.markers.hdl = {})).join(), /needs at least one tip/);
  assert.match(bad((c) => (c.not_medical_advice = 'Be careful.')).join(), /not_medical_advice must say/);
  assert.match(bad((c) => delete c.red_notice).join(), /red_notice missing/);
  assert.match(bad((c) => (c.markers.extra = { low: 'x' })).join(), /unknown marker/);
  assert.match(bad((c) => (c.schema_version = 2)).join(), /schema_version/);
});
