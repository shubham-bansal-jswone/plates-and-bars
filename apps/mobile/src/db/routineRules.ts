import { ROUTINE_NAME_MAX, ROUTINE_SETS_MAX, ROUTINE_SETS_MIN, isBlank, validId } from '@plate-and-bar/core';

// The routine and exercise rules shared by `createRoutine` (refuses) and restore (repairs or skips), so the two cannot drift.
// Every limit is the contract's (packages/api/openapi.yaml, Routine, RoutineExercise, WorkoutExercise) through core's constants
// and packages/api/test-vectors/routines.json. Pure: no database, no screen.

/** Contract unlisted-key limits of `RoutineExercise` and `WorkoutExercise`: at most 20 keys, key names up to 50, string values up to 200. */
const MAX_KEYS = 20;
const KEY_MAX = 50;
/** Also the exercise name limit (core's EXERCISE_NAME_MAX): a name is a string value, so it is bounded here. */
export const VALUE_MAX = 200;

/** Length in code points, as the contract counts. */
export const len = (s: string) => [...s].length;

/** A routine name: a string, not blank, at most ROUTINE_NAME_MAX code points. Not trimmed here. */
export const routineNameOk = (name: unknown): name is string => typeof name === 'string' && !isBlank(name) && len(name) <= ROUTINE_NAME_MAX;

/** The contract's bounded-open rule: at most 20 keys, each key up to 50 characters, each value a boolean, number, string up to 200 or null. */
export function boundedOpenOk(e: Record<string, unknown>): boolean {
  const entries = Object.entries(e);
  return entries.length <= MAX_KEYS && entries.every(([k, v]) => len(k) <= KEY_MAX && (v === null || typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && len(v) <= VALUE_MAX)));
}

/**
 * What is wrong with a routine exercise, or null. `repairable` leaves out the two things restore fixes instead of refusing:
 * a set count outside the limits (clamped) and a group id outside the contract pattern (dropped to null).
 */
export function exerciseProblem(e: Record<string, unknown>, repairable: boolean): 'exercises' | 'sets' | null {
  if (typeof e.name !== 'string' || isBlank(e.name) || !boundedOpenOk(e)) return 'exercises';
  if (!repairable && e.group != null && !validId(e.group)) return 'exercises';
  if (typeof e.sets !== 'number' || !Number.isInteger(e.sets)) return 'sets';
  if (!repairable && (e.sets < ROUTINE_SETS_MIN || e.sets > ROUTINE_SETS_MAX)) return 'sets';
  return null;
}
