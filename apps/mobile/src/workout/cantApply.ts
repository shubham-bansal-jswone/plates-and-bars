import { cantSession, type CantDraft, type Exclusion, type LiftRecord, type NewCantSet, type Where } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { loadLifts, loadSets, loadWorkout, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { catalog } from './catalog';
import { stamp } from './model';
import type { Workout, WorkoutSet } from './types';
import { enqueueDay } from './dayQueue';

export interface CantChange {
  exercises: Workout['exercises'];
  /** Every live set of the workout after the change. */
  sets: WorkoutSet[];
  /** Renumbered sets, `updated_at` stamped. */
  changed: WorkoutSet[];
  /** Sets taken out, as tombstones. */
  removed: WorkoutSet[];
  /** New blank sets, with ids. */
  added: WorkoutSet[];
}

/**
 * Runs core's `cantSession` on a stored workout and turns its result into records: new blank sets get an id and sync
 * fields, renumbered sets are stamped, removed ones become tombstones (`deleted_at`), never hard deletes.
 */
export function cantChange(
  workout: Workout,
  sets: readonly WorkoutSet[],
  i: number | null,
  draft: CantDraft,
  choice: string | null,
  where: Where,
  exclusions: readonly Exclusion[],
  lifts: Readonly<Record<string, LiftRecord>>,
  date: string,
  at: string,
): CantChange {
  const res = cantSession(workout.exercises, sets, i, draft, choice, where, exclusions, { lifts, date }, catalog);
  const added: WorkoutSet[] = [];
  const all = res.sets.map((s) => {
    if ('id' in s) return s as WorkoutSet;
    const n = s as NewCantSet;
    const rec: WorkoutSet = { ...n, id: newId(), version: 0, updated_at: at, deleted_at: null, workout_id: null };
    added.push(rec);
    return rec;
  });
  return {
    exercises: res.exercises as Workout['exercises'],
    sets: all.filter((s) => !s.deleted_at),
    changed: res.changed.map((s) => ({ ...s, updated_at: at })),
    removed: res.removed.map((s) => ({ ...s, updated_at: at, deleted_at: at })),
    added,
  };
}

/**
 * Writes a change. Runs inside the day queue: it re-reads the stored workout and sets, so a version a sync pull stored
 * in the meantime is kept (a stale in-memory copy never writes its old version back).
 */
export async function persistCant(db: WorkoutDb, date: string, base: Workout, ch: CantChange, at: string): Promise<void> {
  const [stored, storedSets] = await Promise.all([loadWorkout(db, date), loadSets(db, date)]);
  const version = new Map(storedSets.map((s) => [s.id, s.version]));
  await saveWorkout(db, { ...base, version: stored?.version ?? base.version, exercises: ch.exercises, updated_at: at });
  for (const s of [...ch.changed, ...ch.removed, ...ch.added]) await saveSet(db, date, { ...s, version: version.get(s.id) ?? s.version });
}

/**
 * A wider rule saved elsewhere (Targets) also applies to today's session if one is already built. Reads today's stored
 * workout inside the day queue, so it lands after any pending Workout-tab write. Does nothing without a workout.
 */
export function applyCantToStoredDay(opts: { db: WorkoutDb; date: string; now: () => Date; draft: CantDraft; choice: string | null; exclusions: readonly Exclusion[]; fallbackWhere: Where; onError: () => void }): Promise<unknown> {
  const { db, date, now, draft, choice, exclusions, fallbackWhere } = opts;
  return enqueueDay(async () => {
    const [workout, sets, lifts] = await Promise.all([loadWorkout(db, date), loadSets(db, date), loadLifts(db)]);
    if (!workout) return;
    const at = stamp(now());
    const ch = cantChange(workout, sets, null, draft, choice, workout.where ?? fallbackWhere, exclusions, lifts, date, at);
    if (ch.removed.length === 0 && ch.added.length === 0 && ch.changed.length === 0) return;
    await persistCant(db, date, workout, ch, at);
  }, opts.onError);
}
