import type { HealthProfile } from './health';
import { sessionMods, type SessionMods, type SessionModsInput } from './day';
import { isExcluded, type Exclusion } from './exclusions';
import { adjustSets, type ExerciseCatalog } from './session';
import { isBlank } from './blank';

/** Contract `Routine` bounds (ADR 011): exercises per routine, and sets per exercise. */
export const ROUTINE_EXERCISES_MAX = 50;
export const ROUTINE_SETS_MIN = 1;
export const ROUTINE_SETS_MAX = 20;
/** Contract routine name limit, in code points (not UTF-16 units). The caller checks it; `routineFromSession` does not. */
export const ROUTINE_NAME_MAX = 60;
/** Contract cap on live (not deleted) routines per account. */
export const ROUTINE_MAX_LIVE = 100;

/** A stored routine exercise (contract `RoutineExercise`): exactly a name and a set count. */
export type RoutineExercise = { name: string; sets: number };

/**
 * The exercises to store for a routine saved from a session: repeat names dropped (first kept), blank names dropped (`isBlank`),
 * at most 50, sets rounded and clamped to 1 to 20. Only `{ name, sets }` is kept: other keys are not stored. Empty in, empty out: the
 * caller must not save an empty routine (contract: 1 to 50 exercises). The name limit (60 code points) is the caller's.
 *
 * New (#1184, ADR 011), not a prototype port: no prototype behaviour, no golden fixture. Tests load
 * packages/api/test-vectors/routines.json.
 */
export function routineFromSession<E extends { name: string; sets: number }>(exercises: readonly E[]): RoutineExercise[] {
  const seen = new Set<string>();
  const out: RoutineExercise[] = [];
  for (const e of exercises) {
    if (out.length >= ROUTINE_EXERCISES_MAX) break;
    if (isBlank(e.name) || seen.has(e.name)) continue;
    seen.add(e.name);
    const sets = Number.isFinite(e.sets) ? Math.round(e.sets) : ROUTINE_SETS_MIN;
    out.push({ name: e.name, sets: Math.min(ROUTINE_SETS_MAX, Math.max(ROUTINE_SETS_MIN, sets)) });
  }
  return out;
}

/** What `startRoutine` reads: the stored routine's exercises and today's state. */
export interface StartRoutineInput extends Omit<SessionModsInput, 'profile' | 'labHold'> {
  /** Names to tags, for `isExcluded`. */
  tags: ExerciseCatalog['tags'];
  /** Setup profile; only `needsClearance` is read (`undefined` or null for none). */
  profile?: HealthProfile | null;
  /** The routine's stored `{ name, sets }` list, in order. */
  routine: readonly { name: string; sets: number }[];
  /** Names in the exercise catalogue (built-in and custom). A routine name not in it is `missing`. */
  catalogue: ReadonlySet<string> | readonly string[];
  /** Active exclusion rules: an excluded routine exercise is `missing` too. Kept in the session either way. */
  exclusions?: readonly Exclusion[];
}

export interface StartedRoutine {
  exercises: { name: string; sets: number; bridge: boolean }[];
  mods: SessionMods;
  /** Always absent: a routine session has no plan template, so it counts as hand-picked (`HAND_PICKED`). */
  base?: undefined;
  /** Routine names the catalogue lacks or an exclusion covers, in routine order, with the reason, for the app to flag. */
  missing: { name: string; reason: 'unknown' | 'excluded' }[];
}

/**
 * Names the catalogue lacks (`unknown`) or an active exclusion covers (`excluded`), in input order, for the app to flag. One rule for
 * `startRoutine` and for the Workout screen, which flags them on every hand-picked session.
 */
export function missingExercises(
  names: readonly string[],
  o: { catalogue: ReadonlySet<string> | readonly string[]; exclusions?: readonly Exclusion[] | undefined; tags: ExerciseCatalog['tags'] },
): StartedRoutine['missing'] {
  const known = o.catalogue instanceof Set ? o.catalogue : new Set(o.catalogue);
  const missing: StartedRoutine['missing'] = [];
  for (const name of names) {
    if (!known.has(name)) missing.push({ name, reason: 'unknown' });
    else if (isExcluded(name, o.exclusions ?? [], o.tags)) missing.push({ name, reason: 'excluded' });
  }
  return missing;
}

/**
 * A session from a saved routine. Each stored set count is the starting number, kept as saved (no 3 floor, no 5 cap,
 * no beginner ramp, no calf bump, no balance override); only the deload and light-day steps (`adjustSets`, shared with
 * `sessionSets`) apply on top. The check-in, re-entry and `needsClearance` come from `sessionMods`; no lab hold (#1088:
 * hand-picked sessions get none). No focus, no bridge. Swapped or removed exercises keep their stored name.
 *
 * New (#1184, decision D2), not a prototype port: no prototype behaviour, no golden fixture.
 */
export function startRoutine(i: StartRoutineInput): StartedRoutine {
  const { labHold: _ignored, ...rest } = i as StartRoutineInput & { labHold?: boolean };
  const { setsLight, mods } = sessionMods(rest);
  const exercises = i.routine.map((r) => ({ name: r.name, sets: adjustSets(r.sets, { deload: mods.deload, light: setsLight }), bridge: false }));
  const missing = missingExercises(i.routine.map((r) => r.name), { catalogue: i.catalogue, exclusions: i.exclusions, tags: i.tags });
  return { exercises, mods, missing };
}
