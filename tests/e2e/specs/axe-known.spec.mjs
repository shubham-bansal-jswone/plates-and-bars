import { expect, test } from '@playwright/test';
import { htmlHas, triage } from '../support/axe.mjs';

// The mechanism behind the known-failure lists in a11y.spec.mjs, tested on synthetic axe results (no browser).
const node = (html) => ({ html, target: ['x'] });
const violation = (id, ...htmls) => ({ id, impact: 'serious', help: id, nodes: htmls.map(node) });
const known = [{ rule: 'aria-required-attr', issue: 1, match: htmlHas('role="radio"') }];

test('a listed element with the listed rule is allowed', () => {
  expect(triage([violation('aria-required-attr', '<div role="radio">')], known)).toEqual({ unexpected: [], stale: [] });
});

test('a new element under the same rule fails', () => {
  const r = triage([violation('aria-required-attr', '<div role="radio">', '<div role="slider">')], known);
  expect(r.unexpected).toHaveLength(1);
  expect(r.unexpected[0]).toContain('role="slider"');
});

test('the listed element under another rule fails', () => {
  expect(triage([violation('label-content-name-mismatch', '<div role="radio">')], known).unexpected).toHaveLength(1);
});

test('an entry that matches nothing is stale', () => {
  const r = triage([], known);
  expect(r.unexpected).toEqual([]);
  expect(r.stale).toHaveLength(1);
});
