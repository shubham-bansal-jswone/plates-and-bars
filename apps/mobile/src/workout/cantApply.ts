import { cantSession, type CantDraft, type Exclusion, type LiftRecord, type NewCantSet, type Where } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { loadLifts, loadSets, loadWorkout, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { getCatalog } from './catalog';
import { fixGroups, mergeWorkout, stamp, unversioned } from './model';
import type { Workout, WorkoutSet } from './types';
import { inTransaction, type PullDb } from '../db/outbox';
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
  const res = cantSession(workout.exercises, sets, i, draft, choice, where, exclusions, { lifts, date }, getCatalog());
  const added: WorkoutSet[] = [];
  const all = res.sets.map((s) => {
    if ('id' in s) return s as WorkoutSet;
    const n = s as NewCantSet;
    const rec: WorkoutSet = { ...n, id: newId(), version: 0, updated_at: at, deleted_at: null, workout_id: null };
    added.push(rec);
    return rec;
  });
  return {
    exercises: fixGroups(res.exercises as Workout['exercises']),
    sets: all.filter((s) => !s.deleted_at),
    changed: res.changed.map((s) => ({ ...s, updated_at: at })),
    removed: res.removed.map((s) => ({ ...s, updated_at: at, deleted_at: at })),
    added,
  };
}

/**
 * Writes a change. Runs inside the day queue: it re-reads the stored workout and sets, so a version a sync pull stored
 * in the meantime is kept (a stale in-memory copy never writes its old version back). With `synced` (the row the screen
 * last loaded or wrote), a stored row that changed since is merged rather than overwritten, as in writeWorkout (#444):
 * the change's exercise list is this device's edit, the rest comes from the stored row. Returns what happened: the row it
 * wrote as is (the screen's new base), or `stale` when it merged or found the workout deleted (the screen should reload).
 */
export async function persistCant(db: WorkoutDb & PullDb, date: string, base: Workout, ch: CantChange, at: string, synced?: Workout | null): Promise<Workout | 'stale'> {
  const [stored, storedSets] = await Promise.all([loadWorkout(db, date), loadSets(db, date)]);
  // Deleted on another device after the screen loaded its copy: stays deleted, like writeWorkout.
  if (stored?.deleted_at && Date.parse(stored.updated_at) > Date.parse(base.updated_at)) return 'stale';
  const version = new Map(storedSets.map((s) => [s.id, s.version]));
  const mine = { ...base, exercises: ch.exercises };
  const elsewhere = !!synced && !!stored && !stored.deleted_at && unversioned(stored) !== unversioned(synced);
  // After a merge the stored list's order wins and this device's new exercises are inserted after their predecessor, so an
  // unticked swap stays in the replaced exercise's place. Nothing is lost or brought back.
  const row = { ...(elsewhere ? mergeWorkout(synced, mine, stored) : mine), version: stored?.version ?? base.version, updated_at: at };
  // A pick another device already added (same name) keeps that device's sets: this change's blank rows for it would sit
  // beside them and double the exercise (#446). By name alone: its sets may not have been pulled yet (#459). Trade-off: if
  // that device's sets never arrive (or were all deleted there), the pick shows no sets and "Add set" recovers it.
  const had = new Set(elsewhere && stored ? stored.exercises.filter((e) => !synced.exercises.some((x) => x.name === e.name)).map((e) => e.name) : []);
  const added = ch.added.filter((s) => !had.has(s.exercise));
  // One transaction (#516). The reads above stay outside it: inside, only `txn` is used, and the day queue is not the write lock, so nothing nests.
  await inTransaction(db, async (txn) => {
    await saveWorkout(txn as WorkoutDb, row);
    for (const s of [...ch.changed, ...ch.removed, ...added]) await saveSet(txn as WorkoutDb, date, { ...s, version: version.get(s.id) ?? s.version });
  });
  return elsewhere ? 'stale' : row;
}

/**
 * A wider rule saved elsewhere (Targets) also applies to today's session if one is already built. Reads today's stored
 * workout inside the day queue, so it lands after any pending Workout-tab write. Does nothing without a live workout.
 */
export function applyCantToStoredDay(opts: { db: WorkoutDb & PullDb; date: string; now: () => Date; draft: CantDraft; choice: string | null; exclusions: readonly Exclusion[]; fallbackWhere: Where; onError: () => void }): Promise<unknown> {
  const { db, date, now, draft, choice, exclusions, fallbackWhere } = opts;
  return enqueueDay(async () => {
    const [workout, sets, lifts] = await Promise.all([loadWorkout(db, date), loadSets(db, date), loadLifts(db)]);
    if (!workout || workout.deleted_at) return;
    const at = stamp(now());
    const ch = cantChange(workout, sets, null, draft, choice, workout.where ?? fallbackWhere, exclusions, lifts, date, at);
    if (ch.removed.length === 0 && ch.added.length === 0 && ch.changed.length === 0) return;
    await persistCant(db, date, workout, ch, at);
  }, opts.onError);
}
