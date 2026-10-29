import { e1rmHistory, mainLifts, type ExType, type PrSet, type SeriesRange, type TrendPoint } from '@plate-and-bar/core';

export interface LiftChoices {
  /** Core's top lifts (`mainLifts`), the chips. */
  main: string[];
  /** Other lifts with at least 2 estimates up to the viewed date, most recent first: the "Choose lift" list. */
  more: string[];
  /** When nothing above exists: the most recent lift with a single estimate. */
  single: string | null;
}

/** Which lifts Progress can show on `end`. Reads all history once; the caller memoizes on `all`, `types` and `end`. */
export function liftChoices(all: readonly PrSet[], types: Readonly<Record<string, ExType>>, end: string): LiftChoices {
  const main = mainLifts(all, types, end).map((m) => m.lift);
  const byLift = new Map<string, PrSet[]>();
  for (const s of all) if (s.date <= end && !s.deleted_at) byLift.set(s.exercise, [...(byLift.get(s.exercise) ?? []), s]);
  const more: { lift: string; n: number; last: string }[] = [];
  const singles: { lift: string; last: string }[] = [];
  for (const [lift, rows] of byLift) {
    if (main.includes(lift)) continue;
    const pts = e1rmHistory(rows, types[lift]);
    const last = pts[pts.length - 1];
    if (!last) continue;
    if (pts.length >= 2) more.push({ lift, n: pts.length, last: last.date });
    else singles.push({ lift, last: last.date });
  }
  const recent = (a: { lift: string; last: string }, b: { lift: string; last: string }) => (a.last < b.last ? 1 : a.last > b.last ? -1 : a.lift < b.lift ? -1 : a.lift > b.lift ? 1 : 0);
  return { main, more: more.sort(recent).map((m) => m.lift), single: singles.sort(recent)[0]?.lift ?? null };
}

/** The lift shown: the held choice if it is still on offer, else the first main lift, else the first other, else the single-point one. */
export function leadLift(c: LiftChoices, choice: string | null): string | null {
  if (choice && (c.main.includes(choice) || c.more.includes(choice))) return choice;
  return c.main[0] ?? c.more[0] ?? c.single;
}

/** One lift's e1RM per day up to `end` (kg), oldest first, as chart points: from the hook's all-history slice, so RangedTrend picks the range. */
export function liftSeries(inRange: (end: string, range: SeriesRange) => PrSet[], end: string, lift: string, type: ExType | undefined): TrendPoint[] {
  return e1rmHistory(inRange(end, 'all').filter((s) => s.exercise === lift && !s.deleted_at), type).map((p) => ({ date: p.date, v: p.e1rm }));
}
