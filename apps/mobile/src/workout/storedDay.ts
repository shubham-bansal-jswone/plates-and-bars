import { HAND_PICKED, newExercise } from '@plate-and-bar/core';
import { inTransaction, type PullDb } from '../db/outbox';
import { loadLifts, loadSets, loadWorkout, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { enqueueDay } from './dayQueue';
import { blankRow, exerciseRecord, isCardioOnly, setRecord, stamp, type ExState } from './model';
import type { Workout } from './types';

type Db = WorkoutDb & PullDb;
const live = (w: Workout | null): w is Workout => !!w && !w.deleted_at;

/** Whether `name` is in the stored session for `date`. */
export async function inStoredDay(db: Db, date: string, name: string): Promise<boolean> {
  const w = await loadWorkout(db, date);
  return live(w) && w.exercises.some((e) => e.name === name);
}

/**
 * Adds a library exercise to the stored session of `date` from outside the Workout tab (the library has no workout hook).
 * Same result as the hook's `addExercise`: default blank work sets (core `newExercise`), joining the last exercise's part,
 * stored in one transaction. With no session yet (or a cardio-only day) it starts a hand-picked one, keeping the cardio
 * minutes, as the Start screen does for picked exercises. Runs in the day queue and re-reads the stored rows, so it lands
 * after any pending Workout-tab write. Resolves 'already' when the exercise is in the session.
 */
export function addToStoredDay(opts: { db: Db; date: string; now: () => Date; name: string; onError: () => void }): Promise<'added' | 'already' | 'failed'> {
  const { db, date, now, name } = opts;
  let result: 'added' | 'already' | 'failed' = 'failed';
  return enqueueDay(async () => {
    const [stored, sets, lifts] = await Promise.all([loadWorkout(db, date), loadSets(db, date), loadLifts(db)]);
    const at = stamp(now());
    const session = live(stored) && !isCardioOnly(stored) ? stored : null;
    if (session?.exercises.some((e) => e.name === name)) return void (result = 'already');
    const part = session?.exercises[session.exercises.length - 1]?.part ?? 1;
    const built = newExercise(name, { lifts, date }, part);
    const ex: ExState = { name, part, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: built.sets.map(() => blankRow()), ramp: [] };
    const base: Workout = session ?? { id: null, version: stored?.version ?? 0, updated_at: at, deleted_at: null, date, template: HAND_PICKED, base: null, where: null, mods: {}, exercises: [], ci_choice: null, cardio_min: live(stored) ? stored.cardio_min : null };
    const row: Workout = { ...base, template: base.template ?? HAND_PICKED, exercises: [...base.exercises, exerciseRecord(ex)], updated_at: at };
    await inTransaction(db, async (txn) => {
      const h = txn as WorkoutDb;
      // Started over a deleted session: its sets go with it, so the new one does not pick them up.
      if (stored?.deleted_at) for (const s of sets) if (!s.deleted_at) await saveSet(h, date, { ...s, updated_at: at, deleted_at: at });
      await saveWorkout(h, row);
      for (let j = 0; j < ex.sets.length; j++) await saveSet(h, date, setRecord(ex, 'work', j, now()));
    });
    result = 'added';
  }, opts.onError).then(() => result);
}

/**
 * Resolves true when the removal was saved (or there was nothing to remove), false when the save failed.
 * Takes `name` out of the stored session (the undo of `addToStoredDay`): its sets become tombstones. The last exercise out
 * leaves a cardio-only day when there are cardio minutes, else deletes the workout, as the hook's `removeExercise` does.
 */
export function removeFromStoredDay(opts: { db: Db; date: string; now: () => Date; name: string; onError: () => void }): Promise<boolean> {
  const { db, date, now, name } = opts;
  let ok = false;
  return enqueueDay(async () => {
    const [stored, sets] = await Promise.all([loadWorkout(db, date), loadSets(db, date)]);
    if (!live(stored) || !stored.exercises.some((e) => e.name === name)) return void (ok = true);
    const at = stamp(now());
    const rest = stored.exercises.filter((e) => e.name !== name);
    const row: Workout = rest.length
      ? { ...stored, exercises: rest, updated_at: at }
      : stored.cardio_min === null
        ? { ...stored, updated_at: at, deleted_at: at }
        : { ...stored, template: null, base: null, where: null, mods: {}, exercises: [], ci_choice: null, updated_at: at };
    await inTransaction(db, async (txn) => {
      const h = txn as WorkoutDb;
      for (const s of sets) if (s.exercise === name && !s.deleted_at) await saveSet(h, date, { ...s, updated_at: at, deleted_at: at });
      await saveWorkout(h, row);
    });
    ok = true;
  }, opts.onError).then(() => ok);
}
