import type { HealthProfile } from './health';
import type { PlanProfile } from './plan';
import { sessionMods, type SessionMods, type SessionModsInput } from './day';
import { BALANCE_EXERCISE, sessionSets, type SessionSetsOptions } from './session';

/** What `seededSession` reads: the picked exercises, the workout they were seeded from, and today's state. */
export interface SeededSessionInput extends Omit<SessionModsInput, 'profile'>, Omit<SessionSetsOptions, 'light' | 'deload' | 'profile'> {
  /** Setup profile; needs both the plan and health fields (`undefined` or null for none). */
  profile?: (PlanProfile & HealthProfile) | null;
  /** The workout the picks were seeded from (contract `Workout.base`). */
  base: string;
  /** The exercises that workout's preview showed (the names the picks were seeded with). */
  seeded: readonly string[];
  /** The final pick list, in order. Names not in `seeded` are additions. */
  picks: readonly string[];
}

export interface SeededSession {
  exercises: { name: string; sets: number; bridge: boolean }[];
  mods: SessionMods;
  base: string;
}

/**
 * A session built from picks that were seeded from a previewed workout (#1020): it keeps that
 * workout as `base`, and the exercises that remain get the check-in, re-entry and deload adjustments
 * `sessionSets` gives a built session. Added exercises get plain defaults (no light or deload change,
 * no focus set). Removed ones are simply absent. The balance exercise is only there if picked.
 *
 * Deliberately deviates from prototype `exPick`, which stores `mods: {}` and no base (decided in #1020).
 * The mods and set counts are `sessionMods` and `sessionSets`, as in `buildSession(t)`.
 */
export function seededSession(i: SeededSessionInput): SeededSession {
  const { setsLight, mods } = sessionMods(i);
  const kept = new Set(i.seeded);
  const keep = i.picks.filter((n) => kept.has(n));
  const plain = { profile: i.profile ?? null, date: i.date, tags: i.tags, ...(i.lastSets ? { lastSets: i.lastSets } : {}) };
  const adjusted = new Map(sessionSets(keep.map((name) => ({ name })), { ...plain, focus: i.focus ?? null, light: setsLight, deload: mods.deload }).map((e) => [e.name, e.sets]));
  const defaults = new Map(sessionSets(i.picks.filter((n) => !kept.has(n)).map((name) => ({ name })), plain).map((e) => [e.name, e.sets]));
  const exercises = i.picks.map((name) => ({ name, sets: (adjusted.get(name) ?? defaults.get(name)) as number, bridge: false }));
  void BALANCE_EXERCISE;
  return { exercises, mods, base: i.base };
}
