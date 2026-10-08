import { daysBetween, mondayOf, weekdayOf } from './dates';

/** Where the user trains. Mirrors the prototype's `profile.where` / `workout.where` values. */
export type Where = 'gym' | 'dumbbells' | 'bodyweight';

/** Experience answer from setup. */
export type Experience = 'new' | 'some' | 'exp';

/** The profile fields the plan engine reads. All optional, as in stored prototype JSON. */
export interface PlanProfile {
  /** Sessions a week, 0–7. 0 means no plan; absent or `null` means the 6-day plan (prototype `p.days ? … : 6`). */
  days?: number | null;
  /** Session length in minutes. Absent, `null` or 0 counts as 60. */
  minutes?: number | null;
  /** `null` at 0 days (contract `Profile.exp`); reads as not new. */
  exp?: Experience | null;
  /** Profile creation date, `YYYY-MM-DD`; starts the beginner 2-set fortnight. */
  created?: string | null;
  age?: number;
  where?: Where;
}

/** One day's entry in prototype `S.sessions.entries`: template done (`t`) and sets logged (`n`). */
export interface SessionEntry {
  t?: string;
  n?: number;
}

/** Logged sessions keyed by date `YYYY-MM-DD` (prototype `S.sessions.entries`). */
export type SessionLog = Readonly<Record<string, SessionEntry>>;

/** A hand-picked plan for one week (prototype `S.settings.adj.weekPlan`). */
export interface WeekPlan {
  /** Monday of the week, `YYYY-MM-DD`. */
  start: string;
  list: readonly string[];
}

/** What `planned` reads from state. */
export interface PlanState {
  profile?: PlanProfile | null;
  sessions: SessionLog;
  weekPlan?: WeekPlan | null;
  /** `'sequence'` runs the plan in order instead of by weekday (prototype `S.settings.adj.mode`). */
  mode?: string | null;
}

/** Mirrors prototype `TEMPLATES` (including the `Object.assign` that adds full-body, upper and lower days). */
export const TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  'Push A': ['Machine Chest Press', 'Incline Dumbbell Press', 'Seated Dumbbell Press', 'Lateral Raise', 'Rope Pushdown'],
  'Pull A': ['Lat Pulldown', 'Seated Cable Row', 'Face Pull', 'Dumbbell Curl', 'Cable Crunch'],
  'Legs A': ['Hack Squat', 'Lying Leg Curl', 'Hip Thrust', 'Leg Extension', 'Standing Calf Raise', 'Cable Crunch'],
  'Push B': ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension'],
  'Pull B': ['Assisted Pull-up', 'Chest-Supported Row', 'One-Arm Dumbbell Row', 'Rear Delt Fly', 'Hammer Curl'],
  'Legs B': ['Leg Press', 'Seated Leg Curl', 'Dumbbell Split Squat', 'Hip Thrust', 'Seated Calf Raise', 'Hanging Knee Raise'],
  'Full body A': ['Hack Squat', 'Machine Chest Press', 'Lat Pulldown', 'Lateral Raise', 'Lying Leg Curl'],
  'Full body B': ['Leg Press', 'Machine Shoulder Press', 'Seated Cable Row', 'Rope Pushdown', 'Dumbbell Curl'],
  'Full body C': ['Hack Squat', 'Incline Dumbbell Press', 'Chest-Supported Row', 'Hip Thrust', 'Face Pull'],
  'Upper A': ['Machine Chest Press', 'Lat Pulldown', 'Seated Dumbbell Press', 'Seated Cable Row', 'Rope Pushdown', 'Dumbbell Curl'],
  'Upper B': ['Barbell Bench Press', 'Chest-Supported Row', 'Machine Shoulder Press', 'Assisted Pull-up', 'Overhead Cable Extension', 'Cable Curl'],
  'Lower A': ['Hack Squat', 'Lying Leg Curl', 'Hip Thrust', 'Leg Extension', 'Standing Calf Raise', 'Cable Crunch'],
  'Lower B': ['Leg Press', 'Seated Leg Curl', 'Dumbbell Split Squat', 'Hip Thrust', 'Seated Calf Raise', 'Hanging Knee Raise'],
};

/** Mirrors prototype `ORDER`: the 6-day push/pull/legs rotation. */
export const ORDER: readonly string[] = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'];

/** A split: templates in order and the weekdays (0 = Sunday) they fall on. */
export interface Split {
  list: readonly string[];
  days: readonly number[];
}

/** Mirrors prototype `SPLITS`, keyed by training days (2–6). */
export const SPLITS: Readonly<Record<2 | 3 | 4 | 5 | 6, Split>> = {
  2: { list: ['Full body A', 'Full body B'], days: [1, 4] },
  3: { list: ['Full body A', 'Full body B', 'Full body C'], days: [1, 3, 5] },
  4: { list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'], days: [1, 2, 4, 5] },
  5: { list: ['Push A', 'Pull A', 'Legs A', 'Upper B', 'Lower B'], days: [1, 2, 3, 5, 6] },
  6: { list: ORDER, days: [1, 2, 3, 4, 5, 6] },
};

const NO_PLAN: Split = { list: [], days: [] };

/**
 * The split for a profile: none for 0 days, otherwise days clamped to 2–6. No profile, or days
 * absent/`null`, gives the 6-day split.
 *
 * Mirrors prototype `splitFor()` (profile passed in instead of read from state).
 */
export function splitFor(profile: PlanProfile | null | undefined): Split {
  if (profile && profile.days === 0) return NO_PLAN;
  const d = profile && profile.days ? Math.min(6, Math.max(2, profile.days)) : 6;
  return SPLITS[d as 2 | 3 | 4 | 5 | 6];
}

/** Mirrors prototype `planList()`. */
export function planList(profile: PlanProfile | null | undefined): readonly string[] {
  return splitFor(profile).list;
}

/** The template that falls on `date`'s weekday, or `null`. Mirrors prototype `dayTemplate(date)`. */
export function dayTemplate(date: string, profile: PlanProfile | null | undefined): string | null {
  const sp = splitFor(profile);
  const i = sp.days.indexOf(weekdayOf(date));
  return i >= 0 ? (sp.list[i] ?? null) : null;
}

/** Dates before `before` with at least one logged set, ascending. Mirrors prototype `sessionDates(before)`. */
function sessionDates(sessions: SessionLog, before: string): string[] {
  return Object.keys(sessions)
    .filter((d) => d < before && (sessions[d]?.n ?? 0) > 0)
    .sort();
}

/**
 * The template planned for `date`, or `null` for a rest day.
 *
 * - A week plan for `date`'s week wins: the next unfinished entry in its list.
 * - Sundays are always rest otherwise.
 * - In sequence mode, the template after the last one done (first if none).
 * - Otherwise the weekday's template from `splitFor`.
 *
 * Mirrors prototype `planned(date)` (state passed in instead of read from `S`).
 */
export function planned(date: string, state: PlanState): string | null {
  const wp = state.weekPlan;
  if (wp && wp.start === mondayOf(date)) {
    const done = sessionDates(state.sessions, date).filter((d) => d >= wp.start).length;
    return wp.list[done] || null;
  }
  if (weekdayOf(date) === 0) return null;
  if (state.mode === 'sequence') {
    const PL = planList(state.profile);
    if (!PL.length) return null;
    const ds = sessionDates(state.sessions, date);
    const last = ds.length ? state.sessions[ds[ds.length - 1] as string] : undefined;
    const i = last ? PL.indexOf(last.t as string) : -1;
    return PL[(i + 1) % PL.length] as string;
  }
  return dayTemplate(date, state.profile);
}

/** Exercises per session for the session length. Mirrors prototype `exerciseCap()` (profile passed in). */
export function exerciseCap(profile: PlanProfile | null | undefined): number {
  const m = profile && profile.minutes ? profile.minutes : 60;
  return m <= 30 ? 3 : m <= 45 ? 4 : m <= 60 ? 5 : m <= 75 ? 6 : 7;
}

/** True in the first 14 days after profile creation for `exp: 'new'`. Inline in prototype `setsFor`. */
export function beginnerRamp(profile: PlanProfile | null | undefined, date: string): boolean {
  return !!(profile && profile.exp === 'new' && profile.created && daysBetween(profile.created, date) < 14);
}

/** True for age 60 and over. Mirrors prototype `older()` (profile passed in). */
export function older(profile: PlanProfile | null | undefined): boolean {
  return !!(profile && (profile.age ?? 0) >= 60);
}
