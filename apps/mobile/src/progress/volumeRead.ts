import { addDays, mondayOf, type CoverageDay, type CoverageSet, type CoverageWorkout } from '@plate-and-bar/core';
import type { WorkoutDb } from '../db/workouts';

/** The first Monday `weeklyDoneSets(…, end, weeks)` counts. */
export const volumeFrom = (end: string, weeks: number): string => addDays(mondayOf(end), -7 * (weeks - 1));

/** One stored workout, as much as coverage reads. */
export interface WorkoutRow {
  date: string;
  workout: CoverageWorkout;
}

/**
 * Every stored workout (date, exercises, deleted_at), one query for all history. The done sets come from `useProgressSets`, so nothing
 * here reads sets. Read on the device, nothing leaves it.
 */
export async function loadWorkoutRows(db: WorkoutDb): Promise<WorkoutRow[]> {
  const rows = await db.getAllAsync<{ key: string; data: string }>('SELECT key, data FROM workouts ORDER BY key');
  return rows.map((r) => {
    const w = JSON.parse(r.data) as CoverageWorkout;
    return { date: r.key, workout: { exercises: w.exercises ?? [], deleted_at: w.deleted_at ?? null } };
  });
}

/** The date of the first live workout (a deleted one is not logged), or null. Rows are oldest first. */
export const firstLogged = (rows: readonly WorkoutRow[]): string | null => rows.find((r) => !r.workout.deleted_at)?.date ?? null;

/** Groups done sets by date once, for `volumeDays`. */
export function indexSets<T extends CoverageSet & { date: string }>(sets: readonly T[]): Map<string, CoverageSet[]> {
  const byDate = new Map<string, CoverageSet[]>();
  for (const s of sets) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  return byDate;
}

/** The `CoverageDay[]` for the `weeks` weeks ending at `end`'s week, in memory: the workouts of those days with their done sets. */
export function volumeDays(rows: readonly WorkoutRow[], byDate: ReadonlyMap<string, readonly CoverageSet[]>, end: string, weeks: number): CoverageDay[] {
  const from = volumeFrom(end, weeks);
  const to = addDays(mondayOf(end), 6);
  return rows.filter((r) => r.date >= from && r.date <= to).map((r) => ({ date: r.date, workout: r.workout, sets: byDate.get(r.date) ?? [] }));
}
