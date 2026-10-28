import { HAND_PICKED, type ImportPlan } from '@plate-and-bar/core';
import { inTransaction, type PullDb } from '../db/outbox';
import { newId } from '../db/records';
import { loadSets, loadWorkout, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { stamp } from '../workout/model';
import type { Workout, WorkoutSet } from '../workout/types';

type Db = WorkoutDb & PullDb;

/** The dates among `dates` that already have a workout (one not deleted). */
export async function occupiedDates(db: WorkoutDb, dates: readonly string[]): Promise<Set<string>> {
  const want = new Set(dates);
  const rows = await db.getAllAsync<{ key: string; data: string }>('SELECT key, data FROM workouts');
  const out = new Set<string>();
  for (const r of rows) {
    if (!want.has(r.key)) continue;
    if (!(JSON.parse(r.data) as { deleted_at?: string | null }).deleted_at) out.add(r.key);
  }
  return out;
}

export interface WriteResult {
  days: number;
  sets: number;
  /** Days that gained a workout between the preview and the write (a sync pull): left as they are. */
  occupied: string[];
}

const DAYS_PER_TXN = 25;

/**
 * Writes the plan's days as finished past workouts and their done work sets, a few days per transaction. The writes go through the
 * normal tables, so the outbox triggers queue them for sync. A day with a live workout is never overwritten; one that was deleted
 * is replaced and keeps its stored version. `lift_stats` is not touched. Nothing waits on the network.
 */
export async function writeImport(db: Db, plan: ImportPlan, now: Date = new Date()): Promise<WriteResult> {
  const at = stamp(now);
  const result: WriteResult = { days: 0, sets: 0, occupied: [] };
  for (let i = 0; i < plan.days.length; i += DAYS_PER_TXN) {
    const chunk = plan.days.slice(i, i + DAYS_PER_TXN);
    const done: WriteResult = { days: 0, sets: 0, occupied: [] };
    await inTransaction(db, async (txn) => {
      for (const d of chunk) {
        const stored = await loadWorkout(txn, d.date);
        if (stored && !stored.deleted_at) {
          done.occupied.push(d.date);
          continue;
        }
        // Over a deleted workout: its sets go with it (as when a session is started over a deleted one), so none shows inside the imported day.
        if (stored?.deleted_at) for (const s of await loadSets(txn as WorkoutDb, d.date)) if (!s.deleted_at) await saveSet(txn, d.date, { ...s, updated_at: at, deleted_at: at });
        const names = [...new Set(d.sets.map((s) => s.exercise))];
        const workout: Workout = {
          id: null,
          version: stored?.version ?? 0,
          updated_at: at,
          deleted_at: null,
          date: d.date,
          // The label of a hand-picked session, never the imported title: the session log reads `base || template`, and the plan engine's
          // sequence mode and variant rotation key on it. An unknown or look-alike title ("Push A") must not move what is suggested next.
          template: HAND_PICKED,
          base: null,
          where: null,
          cardio_min: null,
          mods: {},
          exercises: names.map((name) => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: true })),
          ci_choice: null,
        };
        await saveWorkout(txn, workout);
        for (const s of d.sets) {
          const row: WorkoutSet = { id: newId(), version: 0, updated_at: at, deleted_at: null, workout_id: null, exercise: s.exercise, kind: 'work', set_index: s.setIndex, weight_kg: s.weightKg, reps: s.reps, done: true, rate: null, t: null };
          await saveSet(txn, d.date, row);
        }
        done.days++;
        done.sets += d.sets.length;
      }
    });
    result.days += done.days;
    result.sets += done.sets;
    result.occupied.push(...done.occupied);
  }
  return result;
}
