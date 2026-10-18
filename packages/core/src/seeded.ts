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
  /** The exercises that workout's preview showed: the app's `BuiltSession.exercises` (name and bridge flag). The balance exercise is recognised by name. */
  seeded: readonly { name: string; bridge?: boolean }[];
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
 * no focus set). Removed ones are simply absent. The balance exercise is only there if picked, and always has 2 sets; a seeded bridge keeps `bridge: true` and its 2-set cap.
 *
 * Deliberately deviates from prototype `exPick`, which stores `mods: {}` and no base (decided in #1020).
 * The mods and set counts are `sessionMods` and `sessionSets`, as in `buildSession(t)`.
 */
export function seededSession(i: SeededSessionInput): SeededSession {
  const { setsLight, mods } = sessionMods(i);
  const previewed = new Map(i.seeded.map((e) => [e.name, e]));
  const plain = { profile: i.profile ?? null, date: i.date, tags: i.tags, ...(i.lastSets ? { lastSets: i.lastSets } : {}) };
  // The balance exercise is never an input to `sessionSets`: it appends it with 2 sets, as `buildSession` does.
  const items = (kept: boolean) =>
    i.picks
      .filter((n) => n !== BALANCE_EXERCISE && previewed.has(n) === kept)
      .map((name) => (previewed.get(name)?.bridge ? { name, bridge: true as const } : { name }));
  const built = [
    ...sessionSets(items(true), { ...plain, focus: i.focus ?? null, light: setsLight, deload: mods.deload }),
    ...sessionSets(items(false), plain),
  ];
  const byName = new Map(built.map((e) => [e.name, e]));
  const exercises = i.picks.map((name) => {
    if (name === BALANCE_EXERCISE) return { name, sets: 2, bridge: false };
    const e = byName.get(name);
    if (!e) throw new Error(`seededSession: no set count for pick "${name}"`);
    return { name, sets: e.sets, bridge: !!e.bridge };
  });
  return { exercises, mods, base: i.base };
}
