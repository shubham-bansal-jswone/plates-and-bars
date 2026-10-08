import { addDays, mondayOf } from './dates';
import { resolveSession, type Exclusion, type Swap } from './exclusions';
import { planList, TEMPLATES, type PlanProfile, type WeekPlan } from './plan';
import { mapForWhere, type ExerciseCatalog } from './session';

/**
 * The muscles the coverage meter shows and the focus picker offers, in the prototype's order.
 * Front shoulders, forearms and lower back are counted but not shown or offered.
 *
 * Mirrors prototype `COVER_SHOW`.
 */
export const COVER_SHOW: readonly string[] = ['chest', 'lats', 'upper-back', 'side-delt', 'rear-delt', 'biceps', 'triceps', 'quads', 'hams', 'glutes', 'calves', 'abs'];

/** Weekly sets under this are flagged (prototype `v < 6` in `coverageHtml`). */
export const COVER_LOW = 6;

/** Weekly sets that fill the meter's bar (prototype `v/12*100` in `coverageHtml`). */
export const COVER_FULL = 12;

/** Most focus muscles at once (prototype `focusAction`'s `F.length >= 3`, `focusList`'s `slice(0, 3)`). */
export const FOCUS_MAX = 3;

/** Approximate hard sets per muscle: a primary muscle counts each set, a secondary one half. Keyed by muscle. */
export type MuscleSets = Record<string, number>;

function add(sets: MuscleSets, tags: ExerciseCatalog['tags'], name: string, n: number): void {
  const t = tags[name];
  if (!t) return;
  for (const m of t.primary) sets[m] = (sets[m] || 0) + n;
  for (const m of t.secondary) sets[m] = (sets[m] || 0) + n / 2;
}

/**
 * The templates the planned meter counts for `date`'s week: the week plan when it starts on that
 * week's Monday, else the profile's split (`planList`; none at 0 days, the 6-day split with no days).
 *
 * Mirrors the `list` step of prototype `weeklyCoverage()`.
 */
export function coverageTemplates(date: string, profile: PlanProfile | null | undefined, weekPlan?: WeekPlan | null): readonly string[] {
  return weekPlan && weekPlan.start === mondayOf(date) ? weekPlan.list : planList(profile);
}

/** What `plannedCoverage` reads. */
export interface PlannedCoverageInput {
  /** Today, `YYYY-MM-DD` (prototype `S.date`): picks the week and keeps bridges while `bridge_until >= date`. */
  date: string;
  /** Contract `Profile`: `days` picks the split, `where` the equipment (absent: gym). */
  profile?: PlanProfile | null;
  /** This week's hand-picked plan (prototype `S.settings.adj.weekPlan`). */
  weekPlan?: WeekPlan | null;
  /** Contract `Exclusion` records. */
  exclusions?: readonly Exclusion[];
  /** Contract `Swap` records. */
  swaps?: readonly Swap[];
  /** Lift history keyed by exercise (prototype `S.lifts`); only presence is read, by replacement candidates. */
  lifts?: Readonly<Record<string, unknown>>;
}

/**
 * Planned weekly sets per muscle: every template of the week (`coverageTemplates`), mapped for the
 * profile's `where` and resolved through exclusions and swaps, 3 sets per exercise and 2 per bridge.
 * Not trimmed to the session length and without focus additions or set changes, as in the prototype.
 * Untagged exercises count nothing. `catalog.tags` must already hold custom tags (`applyCustomTags`).
 *
 * Mirrors prototype `weeklyCoverage()` (state passed in).
 */
export function plannedCoverage(input: PlannedCoverageInput, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>): MuscleSets {
  const where = (input.profile && input.profile.where) || 'gym';
  const state = { date: input.date, exclusions: input.exclusions ?? [], swaps: input.swaps ?? [], lifts: input.lifts ?? {} };
  const sets: MuscleSets = {};
  for (const t of coverageTemplates(input.date, input.profile, input.weekPlan)) {
    const items = resolveSession(mapForWhere(TEMPLATES[t] || [], where, catalog), where, state, catalog);
    for (const { name, bridge } of items) add(sets, catalog.tags, name, bridge ? 2 : 3);
  }
  return sets;
}

/** The fields of a contract `Workout` that `doneCoverage` reads. */
export interface CoverageWorkout {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  exercises: readonly { name: string }[];
  /** A tombstone: a non-null value means the workout was deleted. */
  deleted_at?: string | null;
}

/** The fields of a contract `WorkoutSet` that `doneCoverage` reads. */
export interface CoverageSet {
  workout_id: string;
  exercise: string;
  kind: 'work' | 'ramp';
  done: boolean;
  deleted_at?: string | null;
}

/**
 * Sets done per muscle in the 7 days ending on `date` (that day and the 6 before it): each ticked work
 * set (not ramp, not deleted) of an exercise in a workout (not deleted), primary muscles 1, secondary
 * one half. Sets whose exercise is not in their workout's `exercises` are not counted (the prototype
 * keeps sets inside exercises). Untagged exercises count nothing.
 *
 * Mirrors prototype `actualCoverage()` (days passed in as contract workouts and sets).
 */
export function doneCoverage(date: string, workouts: readonly CoverageWorkout[], sets: readonly CoverageSet[], tags: ExerciseCatalog['tags']): MuscleSets {
  const week = new Set(Array.from({ length: 7 }, (_, k) => addDays(date, k - 6)));
  const done = new Map<string, number>();
  for (const s of sets) {
    if (s.deleted_at || s.kind !== 'work' || !s.done) continue;
    const k = `${s.workout_id}\u0000${s.exercise}`;
    done.set(k, (done.get(k) ?? 0) + 1);
  }
  const out: MuscleSets = {};
  for (const w of workouts) {
    if (w.deleted_at || !week.has(w.date)) continue;
    for (const e of w.exercises) add(out, tags, e.name, done.get(`${w.id}\u0000${e.name}`) ?? 0);
  }
  return out;
}

/** One row of the coverage meter. */
export interface CoverageRow {
  muscle: string;
  /** Weekly sets, unrounded (halves from secondary muscles). */
  sets: number;
  /** The number shown: `Math.round(sets)`. */
  shown: number;
  /** Under `COVER_LOW` sets: flagged. */
  low: boolean;
  /** Bar width in percent, `min(100, sets / 12 * 100)`, unrounded. */
  barPct: number;
}

/**
 * The meter's rows in `COVER_SHOW` order; muscles with no sets get 0.
 *
 * Mirrors the rows of prototype `coverageHtml()` and `fillActualCoverage()`.
 */
export function coverageRows(sets: Readonly<MuscleSets>): CoverageRow[] {
  return COVER_SHOW.map((muscle) => {
    const v = sets[muscle] || 0;
    return { muscle, sets: v, shown: Math.round(v), low: v < COVER_LOW, barPct: Math.min(100, (v / COVER_FULL) * 100) };
  });
}

/** What `weeklyCoverage` reads: `plannedCoverage`'s input plus the logged workouts and sets. */
export interface WeeklyCoverageInput extends PlannedCoverageInput {
  workouts: readonly CoverageWorkout[];
  sets: readonly CoverageSet[];
}

/**
 * Both meters on the Targets screen: "Weekly coverage: your plan" and "Done in the last 7 days".
 *
 * Mirrors prototype `coverageHtml()` (planned, from `weeklyCoverage()`) and `fillActualCoverage()`
 * (done, from `actualCoverage()`).
 */
export function weeklyCoverage(input: WeeklyCoverageInput, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>): { planned: CoverageRow[]; done: CoverageRow[] } {
  return {
    planned: coverageRows(plannedCoverage(input, catalog)),
    done: coverageRows(doneCoverage(input.date, input.workouts, input.sets, catalog.tags)),
  };
}

/** The focus picker: a chip per `COVER_SHOW` muscle and which notes show. */
export interface FocusPicker {
  chips: { muscle: string; pressed: boolean }[];
  /** "Training abs builds them, but doesn't burn belly fat by itself…" */
  absNote: boolean;
  /** "Other muscles keep enough work…; aim for about 12–16 weekly sets on your focus muscles…" */
  volumeHint: boolean;
}

/**
 * The focus picker's state from contract `Settings.focus`. Only the first 3 count, as everywhere
 * focus is read.
 *
 * Mirrors prototype `focusHtml()`.
 */
export function focusPicker(focus: readonly string[] | null | undefined): FocusPicker {
  const F = (focus || []).slice(0, FOCUS_MAX);
  return { chips: COVER_SHOW.map((muscle) => ({ muscle, pressed: F.includes(muscle) })), absNote: F.includes('abs'), volumeHint: F.length > 0 };
}

/** What tapping a focus chip did: `full` means it was refused ("Up to 3 focus muscles. Remove one first."). */
export type FocusToggleResult = 'added' | 'removed' | 'full';

/**
 * Tapping focus chip `m`: removes it if picked, else adds it at the end unless 3 are already picked.
 * The whole stored list is read (not only the first 3). `m` is not checked against `COVER_SHOW`; the
 * picker offers only those. On `full` the list comes back unchanged and is not saved. The app's toast
 * after a change lists the new focus muscles, or "No focus muscles" when none are left.
 *
 * Mirrors prototype `focusAction(a, b)`.
 */
export function toggleFocus(focus: readonly string[] | null | undefined, m: string): { focus: string[]; result: FocusToggleResult } {
  const F = (focus || []).slice();
  const i = F.indexOf(m);
  if (i >= 0) {
    F.splice(i, 1);
    return { focus: F, result: 'removed' };
  }
  if (F.length >= FOCUS_MAX) return { focus: F, result: 'full' };
  F.push(m);
  return { focus: F, result: 'added' };
}
