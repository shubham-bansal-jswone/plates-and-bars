import { e1rmHistory, kgLabel, round1, sessionElapsed, type E1rmPoint, type ExType, type Rate, type SessionElapsed } from '@plate-and-bar/core';

/** The fields of a stored set the estimate and the elapsed time read. */
export interface TrendSet {
  date: string;
  kind: 'work' | 'ramp';
  weight_kg: number | null;
  reps: number | null;
  done: boolean;
  rate: Rate | null;
}

/** Best estimate per day for one exercise, oldest first. Core decides what counts (done work sets, no `fail`, loaded types, `E1RM_MAX_REPS` reps or fewer). One workout is one day, so the day is the session key. */
export const e1rmPoints = (sets: readonly TrendSet[], type?: ExType): E1rmPoint[] => e1rmHistory(sets, type);

const DAY = 86_400_000;
const days = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** "Estimated 1-rep max: 82 kg, up 3 kg over 6 weeks" for screen readers; null under 2 points. */
export function e1rmSummary(points: readonly E1rmPoint[], type: ExType): string | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return null;
  const d = round1(last.e1rm - first.e1rm);
  const n = days(first.date, last.date);
  const span = n >= 14 ? `${Math.round(n / 7)} weeks` : n === 1 ? '1 day' : `${n} days`;
  const move = d > 0 ? `up ${d} kg` : d < 0 ? `down ${-d} kg` : 'unchanged';
  return `Estimated 1-rep max: ${kgLabel(last.e1rm, { type, lo: 0, hi: 0, step: 0 })}, ${move} over ${span}`;
}

/** "1 h 10 min", "45 min", "less than 1 min". */
export function durationText(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 1) return 'less than 1 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** The elapsed-time line, or null when core says the data is incomplete (a done set has no usable tick) or there is no span. A long break is named, not hidden. */
export function elapsedLine(e: SessionElapsed | null): string | null {
  if (!e || !e.complete) return null;
  return e.split ? `about ${durationText(e.seconds)} of training (long break excluded)` : durationText(e.seconds);
}

/** Core's `sessionElapsed` on the done sets of a session, as text. */
export const sessionTimeLine = (sets: readonly { done: boolean; t: string | null }[]): string | null => elapsedLine(sessionElapsed(sets));
