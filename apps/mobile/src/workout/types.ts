import type { Rate, SessionMods } from '@plate-and-bar/core';
import type { SyncMeta } from '../setup/types';

// Contract records (packages/api/openapi.yaml), snake_case. Workout is a natural-key table:
// its contract id is a UUIDv5 that needs the user's namespace, so `id` is null on a row made on the device and the server id on a pulled one.
// Lift records are not here: lift_stats keeps core's own record shape (see src/db/workouts.ts).
// buildRecord sets the id (and `WorkoutSet.workout_id`, the UUIDv5 of `workouts:<date>`) at push time for the signed-in user; a pulled row keeps the server values (storeRecord).

export type Form = 'yes' | 'no' | null;

/** Contract `WorkoutExercise`. */
export interface WorkoutExercise {
  name: string;
  part: 1 | 2;
  bridge: boolean;
  form: Form;
  found_kg: number | null;
  skip_ramp: boolean;
  /** Where the last set was felt: 'target', 'pain', or the index of the card's `misplaced_feel` entry (#485). */
  feel?: string | null;
  /** Exercise group (superset) id, `^[A-Za-z0-9_-]{1,36}$`; null or absent is ungrouped. Ungrouping is written as an explicit null (ADR 012). */
  group?: string | null;
}

/** Contract `Workout`: one per day. */
export interface Workout extends Omit<SyncMeta, 'id'> {
  id: string | null;
  date: string;
  template: string | null;
  base: string | null;
  where: 'gym' | 'dumbbells' | 'bodyweight' | null;
  cardio_min: number | null;
  /** Session modifiers; the shape is core's `SessionMods` (the contract stores it as is). */
  mods: Partial<SessionMods>;
  exercises: WorkoutExercise[];
  ci_choice: 'light' | 'swap' | 'orig' | null;
}

/** Contract `WorkoutSet`. */
export interface WorkoutSet extends Omit<SyncMeta, 'id'> {
  id: string;
  /** Null on a set made on the device, the server's workout id on a pulled one (see the note above). */
  workout_id: string | null;
  exercise: string;
  kind: 'work' | 'ramp';
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  done: boolean;
  rate: Rate | null;
  t: string | null;
}
