import type { WeightUnit } from '@plate-and-bar/core';
import { weightWithUnit } from '../workout/unitText';
import { e1rmChange } from './e1rm';

export const STRENGTH_TITLE = 'Strength';
export const STRENGTH_LOADING = 'Loading…';
export const STRENGTH_ERROR = 'Your strength history could not be loaded.';
export const STRENGTH_EMPTY = 'Log a few sessions with weights and your strength trend shows here.';
export const CHOOSE_LIFT = 'Choose lift';
export const CHOOSE_LIFT_LIST = 'Lifts to show';
export const LIFT_CHIPS = 'Lift';
export const PR_TITLE = 'Recent personal bests';
export const PR_NONE = 'No personal bests yet.';

/** "Bench Press estimated 1-rep max 92 kg, up 5 kg in 12 weeks"; with no earlier point, just the first part. Spoken as it is shown (screen readers spell out "e1RM"). */
export function strengthSentence(lift: string, last: { date: string; kg: number }, first: { date: string; kg: number } | null, unit: WeightUnit): string {
  const now = `${lift} estimated 1-rep max ${weightWithUnit(last.kg, unit)}`;
  if (!first) return now;
  const { move, span } = e1rmChange(first, last, unit);
  return `${now}, ${move} in ${span}`;
}
