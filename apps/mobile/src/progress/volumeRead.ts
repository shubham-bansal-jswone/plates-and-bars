import { addDays, mondayOf, type CoverageDay, type CoverageSet, type CoverageWorkout } from '@plate-and-bar/core';
import { loadDoneSets, type WorkoutDb } from '../db/workouts';

/** The first Monday `weeklyDoneSets(…, end, weeks)` counts. */
export const volumeFrom = (end: string, weeks: number): string => addDays(mondayOf(end), -7 * (weeks - 1));

/** What the volume section reads: the logged days of its weeks, and the first logged workout's date (null when there is none). */
export interface VolumeInputs {
  days: CoverageDay[];
  since: string | null;
}

/**
 * Two reads for the whole range, never one per day: the workouts (date, exercises, deleted_at) from the first Monday of the
 * `weeks` weeks ending at `end`'s week, and the done work sets of those days (`loadDoneSets`) grouped by date; plus `since`,
 * the date of the first live workout ever stored (`MIN(key)`; a deleted workout is not logged). Read on the device, nothing leaves it.
 */
export async function loadVolumeInputs(db: WorkoutDb, end: string, weeks: number): Promise<VolumeInputs> {
  const from = volumeFrom(end, weeks);
  const to = addDays(mondayOf(end), 6);
  const [rows, sets, first] = await Promise.all([
    db.getAllAsync<{ key: string; data: string }>('SELECT key, data FROM workouts WHERE key >= ? AND key <= ? ORDER BY key', from, to),
    loadDoneSets(db, from, to),
    db.getAllAsync<{ since: string | null }>("SELECT MIN(key) AS since FROM workouts WHERE json_extract(data, '$.deleted_at') IS NULL"),
  ]);
  const byDate = new Map<string, CoverageSet[]>();
  for (const s of sets) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  const days = rows.map((r): CoverageDay => {
    const w = JSON.parse(r.data) as CoverageWorkout;
    return { date: r.key, workout: { exercises: w.exercises, deleted_at: w.deleted_at ?? null }, sets: byDate.get(r.key) ?? [] };
  });
  return { days, since: first[0]?.since ?? null };
}
