import type { ExType, PersonalRecord, WeightUnit } from '@plate-and-bar/core';
import { weightNumber, weightWithUnit } from '../workout/unitText';
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
export const PR_LABEL = 'Personal best';

/** "Bench Press estimated 1-rep max 92 kg, up 5 kg in 12 weeks"; with no earlier point, just the first part. Spoken as it is shown (screen readers spell out "e1RM"). */
export function strengthSentence(lift: string, last: { date: string; kg: number }, first: { date: string; kg: number } | null, unit: WeightUnit): string {
  const now = `${lift} estimated 1-rep max ${weightWithUnit(last.kg, unit)}`;
  if (!first) return now;
  const { move, span } = e1rmChange(first, last, unit);
  return `${now}, ${move} in ${span}`;
}

/** The score of a record with its metric: "e1RM 100 kg", "32 reps in total", "45 sec in total", "assisted score 240". */
export function prScore(r: PersonalRecord, type: ExType | undefined, unit: WeightUnit): string {
  if (r.metric === 'e1rm') return `e1RM ${weightWithUnit(r.score, unit)}`;
  if (r.metric === 'reps') return `${r.score} ${type === 'time' ? 'sec' : 'reps'} in total`;
  return `assisted score ${r.score}`;
}

/** "+2.5 kg on previous best". */
export function prGain(r: PersonalRecord, type: ExType | undefined, unit: WeightUnit): string {
  if (r.metric === 'e1rm') return `+${weightNumber(r.delta, unit)} ${unit} on previous best`;
  if (r.metric === 'reps') return `+${r.delta} ${type === 'time' ? 'sec' : 'reps'} on previous best`;
  return `+${r.delta} on previous best`;
}
