// Display text for the "can’t do" sheet and the avoid list, from the prototype (REASONS, PATTERN, FAMILY, ruleText).
import labels from '../../../../content/labels.json';
import type { Exclusion, ExclusionReason } from '@plate-and-bar/core';
import { shortDate } from '../format';
import { jointLabel } from './reasons';

export const REASONS: [ExclusionReason, string][] = [
  ['pain', 'Pain or an injury'],
  ['equip', 'Equipment isn’t available'],
  ['dislike', 'I don’t like it'],
  ['form', 'Not confident with the form'],
];

export const DURATIONS: [string, string][] = [
  ['today', 'Just today'],
  ['2w', 'For 2 weeks, then check again'],
  ['4w', 'For 4 weeks, then check again'],
  ['perm', 'Permanently'],
];

export const PATTERN: Record<string, string> = labels.patterns;

export const FAMILY: Record<string, string> = labels.families;

/** What a rule leaves out ("All bench press variations"); prototype `ruleText` before the comma. */
export function ruleWhat(r: Pick<Exclusion, 'scope' | 'key'>): string {
  return r.scope === 'exercise' ? r.key : r.scope === 'family' ? `All ${FAMILY[r.key] ?? r.key}` : r.scope === 'pattern' ? `All ${PATTERN[r.key] ?? r.key}` : `Anything that loads the ${jointLabel(r.key)}`;
}

const REASON_SHORT: Record<string, string> = { pain: 'pain', equip: 'no equipment', dislike: 'don’t like it', form: 'form confidence' };

/** "Pec Deck Fly (don’t like it), check again 22 Oct" (prototype `ruleText`). */
export function ruleText(r: Pick<Exclusion, 'scope' | 'key' | 'reason' | 'until'>): string {
  const why = (r.reason && REASON_SHORT[r.reason]) || '';
  return `${ruleWhat(r)}${why ? ` (${why})` : ''}, ${r.until ? `check again ${shortDate(r.until)}` : 'permanent'}`;
}
