import type { Rate } from '@plate-and-bar/core';
import type { SyncMeta } from '../setup/types';

// Contract records (packages/api/openapi.yaml), snake_case. Workout and LiftStat are natural-key tables:
// their contract id is a UUIDv5 that needs the user's namespace, so `id` stays null locally.
// TODO(#31): fill in `id` (and `WorkoutSet.workout_id`, the UUIDv5 of `workouts:<date>`) once the store is bound to a user.

export type Form = 'yes' | 'no' | null;

/** Contract `WorkoutExercise`. */
export interface WorkoutExercise {
  name: string;
  part: 1 | 2;
  bridge: boolean;
  form: Form;
  found_kg: number | null;
  skip_ramp: boolean;
}

/** Contract `Workout`: one per day. */
export interface Workout extends Omit<SyncMeta, 'id'> {
  id: null;
  date: string;
  template: string | null;
  base: string | null;
  where: 'gym' | 'dumbbells' | 'bodyweight' | null;
  cardio_min: number | null;
  mods: Record<string, unknown>;
  exercises: WorkoutExercise[];
  ci_choice: 'light' | 'swap' | 'orig' | null;
}

/** Contract `WorkoutSet`. */
export interface WorkoutSet extends Omit<SyncMeta, 'id'> {
  id: string;
  /** Null locally, see the note above. */
  workout_id: null;
  exercise: string;
  kind: 'work' | 'ramp';
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  done: boolean;
  rate: Rate | null;
  t: string | null;
}

/** Contract `LiftSet`. */
export interface LiftStatSet {
  weight_kg: number;
  reps: number;
  rate: Rate | null;
}

/** Contract `LiftStat`: one per exercise. */
export interface LiftStat extends Omit<SyncMeta, 'id'> {
  id: null;
  exercise: string;
  date: string;
  sets: LiftStatSet[];
  form: Form;
  sessions: number;
  first: string;
  prev: { date: string; sets: LiftStatSet[]; form: Form } | null;
  history: { date: string; score: number }[];
  pb_toast_date: string | null;
}
