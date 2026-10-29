import { addDays, mondayOf } from './dates';
import type { TrendPoint } from './progress';

/**
 * Progress chart series helpers (#1351 C1). New rules, not prototype ports. Pure; dates are `YYYY-MM-DD`.
 */

/** Chart ranges: 4 weeks, 12 weeks, or everything. */
export type SeriesRange = '4w' | '12w' | 'all';

/** Days back from today for each bounded range (4 and 12 weeks). */
export const RANGE_DAYS: Readonly<Record<'4w' | '12w', number>> = { '4w': 28, '12w': 84 };

/** A series with more points than this is reduced to one point per week by `downsampleWeekly`. */
export const DOWNSAMPLE_THRESHOLD = 120;

/** Which value represents a week: its last point, or its highest. */
export type DownsampleMode = 'last' | 'max';

/**
 * Points dated on or after `today` minus 28 days ('4w') or 84 days ('12w'); the boundary day is kept.
 * 'all' keeps every point. Order is unchanged and the input is not modified.
 *
 * New rule (#1351 C1).
 */
export function rangeSeries(points: readonly TrendPoint[], today: string, range: SeriesRange): TrendPoint[] {
  if (range === 'all') return [...points];
  const cut = addDays(today, -RANGE_DAYS[range]);
  return points.filter((p) => p.date >= cut);
}

/**
 * With more than `DOWNSAMPLE_THRESHOLD` points, one point per Monday-week (`mondayOf`, calendar days so a DST
 * change does not matter), oldest week first: for 'last' the week's latest point, for 'max' its highest value
 * (the earliest such point on a tie). The kept point keeps its own date and value. A series at or under the
 * threshold is returned unchanged. Input need not be sorted.
 *
 * New rule (#1351 C1).
 */
export function downsampleWeekly(points: readonly TrendPoint[], mode: DownsampleMode): TrendPoint[] {
  if (points.length <= DOWNSAMPLE_THRESHOLD) return [...points];
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const weeks = new Map<string, TrendPoint>();
  for (const p of sorted) {
    const wk = mondayOf(p.date);
    const cur = weeks.get(wk);
    if (!cur || mode === 'last' || p.v > cur.v) weeks.set(wk, p);
  }
  return [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, p]) => p);
}
