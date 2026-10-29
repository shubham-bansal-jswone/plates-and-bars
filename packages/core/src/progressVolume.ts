import { addDays, mondayOf } from './dates';
import { addDoneSets, COVER_FULL, COVER_LOW, COVER_SHOW, type CoverageDay, type MuscleSets } from './coverage';
import type { ExerciseCatalog } from './session';

/**
 * Progress volume helpers (#1351 C2). New rules, not prototype ports; the per-set counting is `doneCoverage`'s.
 * Pure; dates are `YYYY-MM-DD`.
 */

/** Weeks `volumeVsPlan` averages. */
export const VOLUME_AVG_WEEKS = 4;

/** One Monday-week of done sets. */
export interface WeekSets {
  /** The week's Monday. */
  week: string;
  /** Done sets per muscle by the `doneCoverage` rule. Every `COVER_SHOW` muscle is present, 0 when none (a real zero). */
  sets: MuscleSets;
  /**
   * True for the week containing `end` when `end` is not its Sunday: the week is not over yet as of the viewed
   * date. This is relative to the viewed date, not to the clock: viewing a past date mid-week shows that week
   * as in progress as of that day, even though it is over in real time.
   */
  partial: boolean;
}

/**
 * Done sets per muscle for each of the `weeks` Monday-weeks ending at the week that contains `end` (the viewed
 * date), oldest first. Counting is `doneCoverage`'s rule (shared `addDoneSets`): work sets that are done, not
 * deleted, in a non-deleted workout; primary muscle 1, secondary 0.5; untagged counts nothing. A week is
 * Monday to Sunday by calendar days, so a DST change does not matter. The last week is the whole Monday-Sunday
 * week, so it equals `doneCoverage` on that Sunday; days after `end` count if they hold data (viewing a past
 * date). A week with no sessions gives 0 for every `COVER_SHOW` muscle, not null. Days outside the weeks are
 * ignored. `weeks` below 1 or not finite gives none. `days` is as `doneCoverage` takes it.
 *
 * New rule (#1351 C2). Mirrors `doneCoverage` for each week.
 */
export function weeklyDoneSets(days: readonly CoverageDay[], end: string, weeks: number, tags: ExerciseCatalog['tags']): WeekSets[] {
  const n = Number.isFinite(weeks) ? Math.floor(weeks) : 0;
  if (n < 1) return [];
  const last = mondayOf(end);
  const out: WeekSets[] = [];
  const index = new Map<string, WeekSets>();
  for (let i = n - 1; i >= 0; i--) {
    const week = addDays(last, -7 * i);
    const sets: MuscleSets = {};
    for (const m of COVER_SHOW) sets[m] = 0;
    const row = { week, sets, partial: i === 0 && addDays(week, 6) !== end };
    out.push(row);
    index.set(week, row);
  }
  for (const d of days) {
    const w = d.workout;
    const row = index.get(mondayOf(d.date));
    if (!w || w.deleted_at || !row) continue;
    addDoneSets(row.sets, tags, w, d.sets);
  }
  return out;
}

/**
 * The muscle to show first on the volume chart: in the most recent week of `weeks` (oldest first, as `weeklyDoneSets` gives them) that holds any
 * done set of a `COVER_SHOW` muscle, the muscle with the most sets; the first of `COVER_SHOW` on a tie. Null when no week holds a set.
 *
 * New rule (#1409): the chart opens on something the user trained, not an empty muscle.
 */
export function recentVolumeMuscle(weeks: readonly WeekSets[]): string | null {
  for (let i = weeks.length - 1; i >= 0; i--) {
    const sets = weeks[i]?.sets ?? {};
    let best: string | null = null;
    for (const m of COVER_SHOW) if ((sets[m] || 0) > (best === null ? 0 : sets[best] || 0)) best = m;
    if (best !== null) return best;
  }
  return null;
}

/** One muscle's row of `volumeVsPlan`. */
export interface VolumeVsPlan {
  muscle: string;
  /** Mean weekly done sets over the weeks used, unrounded. 0 when none were used. */
  avg: number;
  /** The current plan's weekly sets for the muscle (`plannedCoverage`), 0 when the plan has none. */
  target: number;
  /** `avg - target`: negative below the plan. */
  gap: number;
  /** The plan asks for sets and the average is under them. False with no target or no complete week. */
  below: boolean;
  /** Under `COVER_LOW` weekly sets, as the coverage meter flags. */
  low: boolean;
  /** `min(100, avg / COVER_FULL * 100)`, the meter's bar width. */
  barPct: number;
}

/** What `volumeVsPlan` returns. */
export interface VolumeVsPlanResult {
  /** The target is the CURRENT plan's, never a past one: label it so. */
  basis: 'current-plan';
  /** Complete weeks averaged, at most `VOLUME_AVG_WEEKS`. */
  weeksUsed: number;
  /** One row per `COVER_SHOW` muscle, in that order. */
  rows: VolumeVsPlan[];
}

/**
 * Per `COVER_SHOW` muscle: the average weekly sets over the last `VOLUME_AVG_WEEKS` usable weeks of `weeks`, the
 * gap to the current plan's sets (`plannedCoverage`) and a below-target flag. `COVER_LOW` and `COVER_FULL` keep
 * their meter meaning (`low`, `barPct`).
 *
 * A week is usable when it is not `partial` (a Tuesday must not read as under target) and it does not end before
 * `since`, the date of the user's first logged workout (zeros from before the user started are not misses). The
 * week containing `since` counts as partial unless `since` is its Monday. `since` is null when there
 * is no history (an empty string counts as null): then `weeksUsed` is 0, averages are 0 and nothing is flagged below. Fewer than 4 usable weeks are
 * averaged as they are.
 *
 * New rule (#1351 C2). Mirrors `coverageRows` for `low` and `barPct`.
 */
export function volumeVsPlan(weeks: readonly WeekSets[], planned: Readonly<MuscleSets>, since: string | null): VolumeVsPlanResult {
  const used = since
    ? weeks.filter((w) => !w.partial && w.week >= since).slice(-VOLUME_AVG_WEEKS)
    : [];
  const rows = COVER_SHOW.map((muscle) => {
    const avg = used.length ? used.reduce((a, w) => a + (w.sets[muscle] || 0), 0) / used.length : 0;
    const target = planned[muscle] || 0;
    return {
      muscle,
      avg,
      target,
      gap: avg - target,
      below: used.length > 0 && target > 0 && avg < target,
      low: avg < COVER_LOW,
      barPct: Math.min(100, (avg / COVER_FULL) * 100),
    };
  });
  return { basis: 'current-plan', weeksUsed: used.length, rows };
}
