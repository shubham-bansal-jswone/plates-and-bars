import type { ExType, PersonalRecord, WeightUnit } from '@plate-and-bar/core';
import { weightNumber, weightWithUnit } from '../workout/unitText';

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

const DAY = 86_400_000;
const days = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** "Bench Press e1RM 92 kg, up 5 kg in 12 weeks"; with no earlier point, just "Bench Press e1RM 92 kg". Amounts are taken in kg and converted once. */
export function strengthSentence(lift: string, last: { date: string; kg: number }, first: { date: string; kg: number } | null, unit: WeightUnit): string {
  const now = `${lift} e1RM ${weightWithUnit(last.kg, unit)}`;
  if (!first) return now;
  const d = weightNumber(Math.abs(last.kg - first.kg), unit);
  const n = days(first.date, last.date);
  const span = n >= 14 ? `${Math.round(n / 7)} weeks` : n === 1 ? '1 day' : `${n} days`;
  const move = d === 0 ? 'unchanged' : last.kg > first.kg ? `up ${d} ${unit}` : `down ${d} ${unit}`;
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
