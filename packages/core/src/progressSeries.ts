import { addDays, mondayOf } from './dates';
import { live, weekOnTrack, weeklySessionGoal, type ProgressDay, type TrendPoint } from './progress';
import type { PlanProfile, SessionLog } from './plan';

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
 * Points dated on or after `end` minus 28 days ('4w') or 84 days ('12w'); the boundary day is kept. `end` is the
 * series end date: the date being viewed (today when viewing today), the same `upTo` the series were built with.
 * 'all' keeps every point. Order is unchanged and the input is not modified.
 *
 * New rule (#1351 C1).
 */
export function rangeSeries(points: readonly TrendPoint[], end: string, range: SeriesRange): TrendPoint[] {
  if (range === 'all') return [...points];
  const cut = addDays(end, -RANGE_DAYS[range]);
  return points.filter((p) => p.date >= cut);
}

/**
 * With more than `DOWNSAMPLE_THRESHOLD` points, one point per Monday-week (`mondayOf`, calendar days so a DST
 * change does not matter), oldest week first: for 'last' the week's latest point, for 'max' its highest value
 * (the earliest such point on a tie). The kept point keeps its own date and value. A series at or under the
 * threshold is returned as a copy, values unchanged. Input need not be sorted.
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
  return [...weeks.values()];
}

/** A Monday-week with fewer than this many logged days is `partial`: its average rests on too few days (#1351 C4). */
export const WEEKLY_INTAKE_MIN_DAYS = 4;

/** Current targets, per day (the same numbers the Targets screen shows). */
export interface IntakeTargets {
  kcal: number;
  protein_g: number;
}

/** One Monday-week of `weeklyIntake`. */
export interface WeeklyIntake {
  /** The week's Monday. */
  weekStart: string;
  /** Days of the week (up to `end`) with at least one live food log. */
  loggedDays: number;
  /** Average over the logged days, unrounded; null when no day is logged (never 0). */
  avgKcal: number | null;
  avgProtein_g: number | null;
  /** 1 to `WEEKLY_INTAKE_MIN_DAYS - 1` logged days: show the values as a thin average. */
  partial: boolean;
  /** The current targets, the same for every week. */
  target: IntakeTargets;
}

/**
 * Average kcal and protein per Monday-week for the `weeks` weeks ending with the week that holds `end`, oldest first.
 * A day counts as logged when it has a live (not deleted) food log: the rule of `weekSummary` and `habits`; the
 * `complete` flag is not used. Days after `end` are ignored, so the current week averages its days so far. A week with
 * no logged day has null averages, not 0 (as the Seven-days bar says "not logged", #503). Every week carries the current `targets`.
 * `weeks` below 1 or NaN gives none.
 *
 * New rule (#1351 C4).
 */
export function weeklyIntake(days: readonly ProgressDay[], end: string, weeks: number, targets: IntakeTargets): WeeklyIntake[] {
  const n = weeks >= 1 ? Math.floor(weeks) : 0, last = mondayOf(end);
  const out: WeeklyIntake[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const ws = addDays(last, -7 * k), we = addDays(ws, 7);
    let logged = 0, sk = 0, sp = 0;
    const seen = new Set<string>();
    for (const d of days) {
      if (d.date < ws || d.date >= we || d.date > end || seen.has(d.date)) continue;
      const meals = live(d.logs);
      if (!meals.length) continue;
      seen.add(d.date);
      logged++;
      for (const m of meals) {
        sk += m.kcal * m.qty;
        sp += m.protein_g * m.qty;
      }
    }
    out.push({
      weekStart: ws,
      loggedDays: logged,
      avgKcal: logged ? sk / logged : null,
      avgProtein_g: logged ? sp / logged : null,
      partial: logged > 0 && logged < WEEKLY_INTAKE_MIN_DAYS,
      target: { kcal: targets.kcal, protein_g: targets.protein_g },
    });
  }
  return out;
}

/** One Monday-week of `weeksOnTrackSeries`. */
export interface WeekOnTrack {
  /** The week's Monday. */
  weekStart: string;
  /** Sessions logged in the week. */
  sessions: number;
  /** Sessions a week to be on track (`habits().goal`). */
  goal: number;
  onTrack: boolean;
}

/**
 * Whether each of the last `weeks` COMPLETED Monday-weeks (the weeks before the one holding `end`, oldest first) was on
 * track, by the goal rule of `habits()` (plan days minus 1, at least 2). The week of `end` is left out, as in `habits`,
 * so the trailing run of `onTrack` equals `habits().weeks` (which stops counting at 26). `weeks` below 1 or NaN gives none.
 *
 * New rule (#1351 C5); the goal and the per-week test are shared with `habits`.
 */
export function weeksOnTrackSeries(sessions: SessionLog, profile: PlanProfile | null | undefined, end: string, weeks: number): WeekOnTrack[] {
  const n = weeks >= 1 ? Math.floor(weeks) : 0, goal = weeklySessionGoal(profile), dates = Object.keys(sessions), monday = mondayOf(end);
  const out: WeekOnTrack[] = [];
  for (let k = n; k >= 1; k--) {
    const ws = addDays(monday, -7 * k), we = addDays(ws, 7);
    out.push({ weekStart: ws, sessions: dates.filter((d) => d >= ws && d < we).length, goal, onTrack: weekOnTrack(dates, ws, goal) });
  }
  return out;
}
