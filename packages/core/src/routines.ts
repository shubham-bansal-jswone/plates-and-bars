import type { HealthProfile } from './health';
import { sessionMods, type SessionMods, type SessionModsInput } from './day';
import { isExcluded, type Exclusion } from './exclusions';
import { adjustSets, type ExerciseCatalog } from './session';
import { isBlank } from './blank';
import { normalizeGroups } from './groups';

/** Contract `Routine` bounds (ADR 011): exercises per routine, and sets per exercise. */
export const ROUTINE_EXERCISES_MAX = 50;
export const ROUTINE_SETS_MIN = 1;
export const ROUTINE_SETS_MAX = 20;
/** Contract routine name limit, in code points (not UTF-16 units). The caller checks it; `routineFromSession` does not. */
export const ROUTINE_NAME_MAX = 60;
/** Contract cap on live (not deleted) routines per account. */
export const ROUTINE_MAX_LIVE = 100;

/** A stored routine exercise (contract `RoutineExercise`): a name, a set count and, for a superset member, a group id local to the routine. */
export type RoutineExercise = { name: string; sets: number; group?: string };

/**
 * Valid-run group ids of `exs` (after `normalizeGroups`) replaced by `make(n)` for the n-th group in order of first appearance.
 * Ungrouped (and dissolved) exercises get no `group` key. Shared by `routineFromSession` and `startRoutine`.
 */
function regroup<E extends { name: string; sets: number; group?: string | null }>(exs: readonly E[], make: () => string): (string | undefined)[] {
  const ids = new Map<string, string>();
  return normalizeGroups(exs).map((e) => {
    if (e.group == null) return undefined;
    if (!ids.has(e.group)) ids.set(e.group, make());
    return ids.get(e.group);
  });
}

/**
 * The exercises to store for a routine saved from a session: repeat names dropped (first kept), blank names dropped (`isBlank`),
 * at most 50, sets rounded and clamped to 1 to 20. Only `{ name, sets }` and `group` are kept: other keys are not stored. `group` (ADR 012)
 * is kept only for members of a valid run (`normalizeGroups`, run again after dedupe and the cap so they cannot leave a broken group),
 * renamed 'g1', 'g2', ... in order of first appearance; ungrouped exercises get no `group` key. Empty in, empty out: the
 * caller must not save an empty routine (contract: 1 to 50 exercises). The name limit (60 code points) is the caller's.
 *
 * New (#1184, ADR 011), not a prototype port: no prototype behaviour, no golden fixture. Tests load
 * packages/api/test-vectors/routines.json.
 */
export function routineFromSession<E extends { name: string; sets: number; group?: string | null }>(exercises: readonly E[]): RoutineExercise[] {
  const seen = new Set<string>();
  const out: { name: string; sets: number; group?: string | null }[] = [];
  for (const e of normalizeGroups(exercises)) {
    if (out.length >= ROUTINE_EXERCISES_MAX) break;
    if (isBlank(e.name) || seen.has(e.name)) continue;
    seen.add(e.name);
    const sets = Number.isFinite(e.sets) ? Math.round(e.sets) : ROUTINE_SETS_MIN;
    out.push({ name: e.name, sets: Math.min(ROUTINE_SETS_MAX, Math.max(ROUTINE_SETS_MIN, sets)), group: e.group ?? null });
  }
  let n = 0;
  const gs = regroup(out, () => `g${++n}`);
  return out.map((e, i) => (gs[i] === undefined ? { name: e.name, sets: e.sets } : { name: e.name, sets: e.sets, group: gs[i] as string }));
}

/** What `startRoutine` reads: the stored routine's exercises and today's state. */
export interface StartRoutineInput extends Omit<SessionModsInput, 'profile' | 'labHold'> {
  /** Names to tags, for `isExcluded`. */
  tags: ExerciseCatalog['tags'];
  /** Setup profile; only `needsClearance` is read (`undefined` or null for none). */
  profile?: HealthProfile | null;
  /** The routine's stored `{ name, sets }` list, in order. */
  routine: readonly { name: string; sets: number; group?: string | null }[];
  /**
   * Makes a fresh group id (contract pattern) per call; each group in the routine gets its own, so two starts never share one.
   * Absent: every exercise starts ungrouped.
   */
  newId?: () => string;
  /** Names in the exercise catalogue (built-in and custom). A routine name not in it is `missing`. */
  catalogue: ReadonlySet<string> | readonly string[];
  /** Active exclusion rules: an excluded routine exercise is `missing` too. Kept in the session either way. */
  exclusions?: readonly Exclusion[];
}

export interface StartedRoutine {
  exercises: { name: string; sets: number; bridge: boolean; group?: string }[];
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
 * hand-picked sessions get none). No focus, no bridge. Groups (ADR 012): a stored group that is a valid run becomes a session group
 * with an id from `newId` (one per group, never the stored id); an invalid one is dropped. Swapped or removed exercises keep their stored name.
 *
 * New (#1184, decision D2), not a prototype port: no prototype behaviour, no golden fixture.
 */
export function startRoutine(i: StartRoutineInput): StartedRoutine {
  const { labHold: _ignored, ...rest } = i as StartRoutineInput & { labHold?: boolean };
  const { setsLight, mods } = sessionMods(rest);
  const gs = i.newId ? regroup(i.routine, i.newId) : [];
  const exercises = i.routine.map((r, k) => {
    const e = { name: r.name, sets: adjustSets(r.sets, { deload: mods.deload, light: setsLight }), bridge: false };
    return gs[k] === undefined ? e : { ...e, group: gs[k] as string };
  });
  const missing = missingExercises(i.routine.map((r) => r.name), { catalogue: i.catalogue, exclusions: i.exclusions, tags: i.tags });
  return { exercises, mods, missing };
}
