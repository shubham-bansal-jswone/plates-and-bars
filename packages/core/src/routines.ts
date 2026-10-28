import type { HealthProfile } from './health';
import type { PlanProfile } from './plan';
import { sessionMods, type SessionMods, type SessionModsInput } from './day';
import { isExcluded, type Exclusion } from './exclusions';
import { BALANCE_EXERCISE, sessionSets, type SessionSetsOptions } from './session';

/** Contract `Routine` bounds (ADR 011): exercises per routine, and sets per exercise. */
export const ROUTINE_EXERCISES_MAX = 50;
export const ROUTINE_SETS_MIN = 1;
export const ROUTINE_SETS_MAX = 20;

/** The contract's shared "not blank" pattern (openapi wire conventions). */
const NOT_BLANK = /[^\t-\r \u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/;

/** A stored routine exercise (contract `RoutineExercise`): unknown keys are kept as they are. */
export type RoutineExercise = { name: string; sets: number; [key: string]: unknown };

/**
 * The exercises to store for a routine saved from a session: repeat names dropped (first kept), blank names dropped,
 * at most 50, sets rounded and clamped to 1 to 20. Extra keys on an exercise are kept. Empty in, empty out: the
 * caller must not save an empty routine (contract: 1 to 50 exercises). The name limit (60 code points) is the caller's.
 *
 * New (#1184, ADR 011), not a prototype port: no prototype behaviour, no golden fixture. Tests load
 * packages/api/test-vectors/routines.json.
 */
export function routineFromSession<E extends { name: string; sets: number }>(exercises: readonly E[]): (E & RoutineExercise)[] {
  const seen = new Set<string>();
  const out: (E & RoutineExercise)[] = [];
  for (const e of exercises) {
    if (out.length >= ROUTINE_EXERCISES_MAX) break;
    if (!NOT_BLANK.test(e.name) || seen.has(e.name)) continue;
    seen.add(e.name);
    const sets = Number.isFinite(e.sets) ? Math.round(e.sets) : ROUTINE_SETS_MIN;
    out.push({ ...e, sets: Math.min(ROUTINE_SETS_MAX, Math.max(ROUTINE_SETS_MIN, sets)) });
  }
  return out;
}

/** What `startRoutine` reads: the stored routine's exercises and today's state. */
export interface StartRoutineInput extends Omit<SessionModsInput, 'profile'>, Omit<SessionSetsOptions, 'light' | 'deload' | 'profile' | 'lastSets'> {
  /** Setup profile; needs both the plan and health fields (`undefined` or null for none). */
  profile?: (PlanProfile & HealthProfile) | null;
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
  /** Routine names the catalogue lacks or an exclusion covers, in routine order, for the app to flag. */
  missing: string[];
}

/**
 * A session from a saved routine. The stored set counts are the starting point and the check-in, re-entry and deload
 * adjustments of `buildSession(t)` apply on top, via `sessionMods` and `sessionSets` (decision D2 on #1184, as
 * `seededSession`). `sessionSets` keeps its 3 to 5 range on the starting count. The balance exercise (60+) is only there if
 * stored, with 2 sets. No focus, no bridge. Swapped or removed exercises keep their stored name.
 *
 * New (#1184), not a prototype port: no prototype behaviour, no golden fixture.
 */
export function startRoutine(i: StartRoutineInput): StartedRoutine {
  const { setsLight, mods } = sessionMods(i);
  const stored = new Map(i.routine.map((e) => [e.name, e.sets]));
  const built = sessionSets(
    i.routine.filter((e) => e.name !== BALANCE_EXERCISE).map((e) => ({ name: e.name })),
    { profile: i.profile ?? null, date: i.date, tags: i.tags, lastSets: (n) => stored.get(n), light: setsLight, deload: mods.deload },
  );
  const byName = new Map(built.map((e) => [e.name, e.sets]));
  const exercises = i.routine.map((r) => ({ name: r.name, sets: r.name === BALANCE_EXERCISE ? 2 : (byName.get(r.name) as number), bridge: false }));
  const names = i.catalogue instanceof Set ? i.catalogue : new Set(i.catalogue);
  const missing = i.routine.map((r) => r.name).filter((n) => !names.has(n) || isExcluded(n, i.exclusions ?? [], i.tags));
  return { exercises, mods, missing };
}

