import { needsClearance, type HealthProfile } from './health';
import { num } from './num';
import { planList, type PlanProfile, type Where } from './plan';
import { inRange, type AdjRange } from './stalls';

/** How the check-in said to build today's session (contract `Workout.ci_choice`; prototype `ciChoice`). */
export type CiChoice = 'light' | 'swap' | 'orig';

/** A re-entry period (prototype `S.settings.adj.reentry`): `pct` lighter (0.15 or 0.3) from `from` to `until`. */
export interface ReentryRange extends AdjRange {
  pct: number;
}

/**
 * Session modifiers stored on the day's workout (contract `Workout.mods`, stored as is; prototype `w.mods`).
 * Read by `applyMods` (as `WorkoutMods`) and the workout screen's "Today: …" note.
 */
export interface SessionMods {
  /** No weight increases and one fewer set: check-in "light", lab hold or `needsClearance`. Re-entry is not included. */
  light: boolean;
  /** Check-in time other than "usual": main exercises only. */
  short: boolean;
  where: Where;
  /** Recovery week in range. */
  deload: boolean;
  /** Re-entry fraction (0.15 or 0.3) when a re-entry period is in range, else 0. */
  reentry: number;
}

/** What `sessionMods` reads. Dates are `YYYY-MM-DD`. */
export interface SessionModsInput {
  /** The session's date (prototype `S.date`). */
  date: string;
  /** Contract `Workout.ci_choice`. */
  ciChoice?: CiChoice | null | undefined;
  /** Check-in time answer (prototype `checkin.time`): 'usual', '45', '30', or unanswered. */
  time?: string | null | undefined;
  /** Where today's session happens (prototype `whereNow()`). */
  where: Where;
  profile?: HealthProfile | null | undefined;
  /** Lab hold on (prototype `labHoldOn()`; not synced in v0). */
  labHold?: boolean | undefined;
  /** Recovery week (prototype `adj.deload`). */
  deload?: AdjRange | null | undefined;
  /** Re-entry period (prototype `adj.reentry`). */
  reentry?: ReentryRange | null | undefined;
}

/**
 * Today's session modifiers and the light flag for set counts.
 *
 * `light` is what `sessionSets` takes: check-in "light", re-entry of 30% or more, lab hold or
 * `needsClearance`. `mods.light`, the stored flag, leaves re-entry out (as the prototype does).
 *
 * Mirrors the `short`, `deload`, `reentry`, `light` and `w.mods` steps of prototype `buildSession(t)`
 * (state passed in). The prototype stores `short` and `deload` as whatever falsy value it computed
 * (`undefined`, `''`, `null`); here they are booleans with the same truthiness.
 */
export function sessionMods(i: SessionModsInput): { light: boolean; mods: SessionMods } {
  const short = !!i.time && i.time !== 'usual';
  const deload = inRange(i.deload, i.date);
  const reentry = i.reentry && inRange(i.reentry, i.date) ? i.reentry.pct : 0;
  const held = !!i.labHold || needsClearance(i.profile);
  const light = i.ciChoice === 'light' || reentry >= 0.3 || held;
  return { light, mods: { light: i.ciChoice === 'light' || held, short, where: i.where, deload, reentry } };
}

/**
 * The workout's display name (contract `Workout.template`): the plan template, with " (dumbbells only)"
 * or " (bodyweight)" appended away from the gym. Stored on the workout, so the formatted value is returned.
 *
 * Mirrors the `w.template` step of prototype `buildSession(t)`.
 */
export function templateName(t: string, where: Where): string {
  return t + (where !== 'gym' ? ` (${where === 'dumbbells' ? 'dumbbells only' : 'bodyweight'})` : '');
}

/** A set as the volume sum reads it: weight and reps as typed (strings, numbers or blank). */
export interface VolumeSet {
  done?: boolean | null | undefined;
  w?: string | number | null | undefined;
  r?: string | number | null | undefined;
}

/**
 * Total kg lifted: weight × reps summed over ticked sets, each parsed with `num` (blank counts 0).
 *
 * Mirrors the `vol` sum in prototype `renderWorkout()`.
 */
export function sessionVolume(exercises: readonly { sets: readonly VolumeSet[] }[]): number {
  let vol = 0;
  for (const ex of exercises) for (const s of ex.sets) if (s.done) vol += num(s.w) * num(s.r);
  return vol;
}

/**
 * The templates "Training again later today?" offers, in plan order, without today's `base`; `null` when
 * the offer is not shown: no exercises, an exercise with no ticked set, or already a two-session day
 * (the template contains "+"). An empty list (shown with no chips) is possible for a one-template plan.
 *
 * Mirrors prototype `secondSessionHtml()` (profile passed in for `planList()`).
 */
export function secondSessionChoices(
  w: { exercises: readonly { sets: readonly { done?: boolean | null | undefined }[] }[]; template?: string | null | undefined; base?: string | null | undefined },
  profile: PlanProfile | null | undefined,
): string[] | null {
  if (!w.exercises.length || !w.exercises.every((e) => e.sets.some((x) => x.done))) return null;
  if (/\+/.test(w.template || '')) return null;
  return planList(profile).filter((t) => t !== w.base);
}

/** The workout fields a second session changes. */
export interface SecondSessionDay<E extends { name: string }> {
  exercises: readonly E[];
  template?: string | null | undefined;
  base?: string | null | undefined;
  mods?: Partial<SessionMods> | null | undefined;
}

/**
 * Today's workout after adding second session `t`. `built` is session `t` as built now (its exercises
 * and `sessionMods(...).mods`). Exercises of `built` not already in the day are appended with
 * `part: 2`; the template becomes "<old template or 'Session'> + t"; the base stays (or becomes `t`);
 * the mods stay the first session's, with `light` on if either session is light.
 *
 * Mirrors prototype `addSecondSession(t)` (`buildSession(t)` passed in as `built`; no saving or toast).
 */
export function mergeSecondSession<E extends { name: string }>(
  old: SecondSessionDay<E>,
  t: string,
  built: { exercises: readonly E[]; mods?: { light?: boolean | undefined } | null | undefined },
): { exercises: (E | (E & { part: 2 }))[]; template: string; base: string; mods: Partial<SessionMods> & { light: boolean } } {
  const have = new Set(old.exercises.map((e) => e.name));
  const add = built.exercises.filter((e) => !have.has(e.name)).map((e) => ({ ...e, part: 2 as const }));
  return {
    exercises: [...old.exercises, ...add],
    template: `${old.template || 'Session'} + ${t}`,
    base: old.base || t,
    mods: { ...(old.mods || {}), light: !!((old.mods || {}).light || (built.mods || {}).light) },
  };
}
