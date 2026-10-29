import { COVER_SHOW, addDays, type VolumeVsPlan, type WeekSets } from '@plate-and-bar/core';
import type { Bar } from './BarChart';

/**
 * The muscle shown first: the user's first focus muscle that the meter shows, else the one furthest below its plan (lowest
 * `avg - target`; with no target that is the lowest average), the first of `COVER_SHOW` on a tie.
 */
export function defaultMuscle(focus: readonly string[], rows: readonly VolumeVsPlan[]): string {
  const f = focus.find((m) => COVER_SHOW.includes(m));
  if (f) return f;
  let best = rows[0];
  for (const r of rows) if (best && r.gap < best.gap) best = r;
  return best?.muscle ?? COVER_SHOW[0] ?? 'chest';
}

/**
 * One bar per week. A week that ended before the first logged workout is a gap ("Not logged"), not a zero: the user had not started.
 * The week in progress as of the viewed date is partial (hollow).
 */
export function volumeBars(weeks: readonly WeekSets[], muscle: string, since: string | null): Bar[] {
  return weeks.map((w) => ({
    label: w.week,
    value: since === null || addDays(w.week, 6) < since ? null : w.sets[muscle] || 0,
    partial: w.partial || undefined,
  }));
}

/** Lowest first: rows below their plan by the biggest gap, then the other low rows and the rest by average. */
export function rankRows(rows: readonly VolumeVsPlan[]): VolumeVsPlan[] {
  const tier = (r: VolumeVsPlan): number => (r.below ? 0 : r.low ? 1 : 2);
  const key = (r: VolumeVsPlan): number => (r.below ? r.gap : r.avg);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => tier(a.r) - tier(b.r) || key(a.r) - key(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** Nothing to chart: no workout stored, or the stored ones hold no done set (an opened, unticked session). */
export function noVolumeYet(weeks: readonly WeekSets[], since: string | null): boolean {
  if (since === null) return true;
  const first = weeks[0];
  return !!first && since >= first.week && weeks.every((w) => COVER_SHOW.every((m) => !w.sets[m]));
}
