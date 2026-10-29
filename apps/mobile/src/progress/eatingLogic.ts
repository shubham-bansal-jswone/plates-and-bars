import { addDays, mondayOf, weeklyIntake, WEEKLY_INTAKE_MIN_DAYS, type ProgressDay, type WeeklyIntake } from '@plate-and-bar/core';
import type { FoodLog } from '../food/types';

/**
 * Fixed 12 weeks, not the 4w/12w/All `RangeControl`: "All" would need every food log read and a bar per week for years, and the weeks
 * on track strip below uses the same span. The 4-week headline is the last 4 of these.
 */
export const EATING_WEEKS = 12;
const HEADLINE_WEEKS = 4;
/** Never fewer bars than the headline's span, however recent the first log is. */
const MIN_BARS = HEADLINE_WEEKS;

/** First day read for a view ending on `end`: the Monday of the first of the 12 weeks. */
export const eatingFrom = (end: string): string => addDays(mondayOf(end), -7 * (EATING_WEEKS - 1));

/** Groups logs by day, as the check-in's `ProgressDay` rows (only `logs` matter to `weeklyIntake`). */
export function daysFromLogs(logs: readonly FoodLog[]): ProgressDay[] {
  const by = new Map<string, FoodLog[]>();
  for (const l of logs) by.set(l.date, [...(by.get(l.date) ?? []), l]);
  return [...by].map(([date, ls]) => ({ date, logs: ls, trained: false }));
}

export interface EatingView {
  /** Oldest first; leading weeks before the first logged one are left out (at least the last 4 stay). */
  weeks: WeeklyIntake[];
  /** Day-weighted average over the last 4 weeks' logged days; null when none. Partial weeks count by the days they have. */
  kcal: number | null;
  protein: number | null;
  /** Some week has `WEEKLY_INTAKE_MIN_DAYS` or more logged days. */
  enough: boolean;
}

/** Targets of 0 mean "not set": the chart draws no line. */
export function eatingView(days: readonly ProgressDay[], end: string, kcalTarget: number, proteinTarget: number): EatingView {
  const all = weeklyIntake(days, end, EATING_WEEKS, { kcal: kcalTarget, protein_g: proteinTarget });
  const firstLogged = all.findIndex((w) => w.loggedDays > 0);
  const weeks = firstLogged < 0 ? all.slice(-MIN_BARS) : all.slice(Math.min(firstLogged, all.length - MIN_BARS));
  let n = 0, sk = 0, sp = 0;
  for (const w of all.slice(-HEADLINE_WEEKS)) {
    if (w.avgKcal === null || w.avgProtein_g === null) continue;
    n += w.loggedDays;
    sk += w.avgKcal * w.loggedDays;
    sp += w.avgProtein_g * w.loggedDays;
  }
  return { weeks, kcal: n ? sk / n : null, protein: n ? sp / n : null, enough: all.some((w) => w.loggedDays >= WEEKLY_INTAKE_MIN_DAYS) };
}
