import { downsampleWeekly, e1rmHistory, mainLifts, type E1rmPoint, type ExType, type PrSet, type SeriesRange, type TrendPoint } from '@plate-and-bar/core';

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

/** e1RM points of one lift in each range, from the hook's per-range slices. Per range: one pass over that slice. */
export function liftRanges(inRange: (end: string, range: SeriesRange) => PrSet[], end: string, lift: string, type: ExType | undefined): Record<SeriesRange, E1rmPoint[]> {
  const of = (r: SeriesRange) => e1rmHistory(inRange(end, r).filter((s) => s.exercise === lift && !s.deleted_at), type);
  return { '4w': of('4w'), '12w': of('12w'), all: of('all') };
}

/** Points as drawn: weekly past about 120 points. Kg, oldest first. */
export const plotted = (pts: readonly E1rmPoint[]): TrendPoint[] => downsampleWeekly(pts.map((p) => ({ date: p.date, v: p.e1rm })), 'last');
