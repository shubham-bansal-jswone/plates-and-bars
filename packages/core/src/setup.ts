import type { ScreenAnswer, ScreenAnswers } from './health';
import { screenFlag } from './health';
import { num } from './num';
import { older } from './plan';
import type { Experience, Where } from './plan';
import { calcTargets } from './targets';
import type { Activity, Goal, Pace, Sex, Special, TargetsProfile, TargetsResult } from './targets';

/** Youngest age setup accepts. Mirrors `age < 18` in prototype `validateStep`. */
export const AGE_MIN = 18;
/** Oldest age setup accepts. Mirrors `age > 90` in prototype `validateStep`. */
export const AGE_MAX = 90;
/** Height limits, cm. Mirrors `cm < 120 || cm > 230` in prototype `validateStep`. */
export const HEIGHT_MIN_CM = 120;
export const HEIGHT_MAX_CM = 230;
/** Weight limits, kg. Mirrors `w < 30 || w > 300` in prototype `validateStep`. */
export const WEIGHT_MIN_KG = 30;
export const WEIGHT_MAX_KG = 300;
/** Session length choices, minutes. Mirrors the chips in prototype `renderSetup` step 2. */
export const SESSION_MINUTES = [30, 45, 60, 75, 90] as const;
/** Sessions-a-week choices (0 is "None yet"). Mirrors the chips in prototype `renderSetup` step 2. */
export const DAY_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** Number of question steps before the results screen. Mirrors `Step ${SU.step+1} of 4`. */
export const SETUP_STEPS = 4;
/** Number of health-check questions. Mirrors prototype `SCREEN_Q.length`. */
export const SCREEN_QUESTIONS = 6;
/** The results screen's "likely range" is TDEE × (1 ∓ this). Mirrors `r.tdee*0.9`, `r.tdee*1.1` in `setupResultHtml`. */
export const BURN_RANGE = 0.1;
/** Within this many kcal of TDEE the target "matches your burn". Mirrors `r.tdee - 20`, `r.tdee + 20` in `setupResultHtml`. */
export const PACE_STEADY_KCAL = 20;

/** Height unit on the first step. Mirrors prototype `SU.unit`. */
export type HeightUnit = 'ft' | 'cm';

/**
 * Answers as the setup form holds them: prototype `SU.p` (picked options) plus `SU.v` (typed text)
 * and `SU.unit`. Typed fields are parsed with `num`, so strings or numbers both work.
 */
export interface SetupAnswers {
  sex: Sex | '';
  /** Women only; ignored (normalised to `none`) for men. Absent counts as `none`. */
  special?: Special;
  age: string | number;
  unit: HeightUnit;
  /** Read when `unit` is `ft`. */
  ft?: string | number;
  /** Read when `unit` is `ft`. */
  inch?: string | number;
  /** Read when `unit` is `cm`. */
  cm?: string | number;
  /** Kg. */
  weight: string | number;
  activity: Activity | '';
  where?: Where | '';
  /** `null` until a chip is picked. */
  days: (typeof DAY_CHOICES)[number] | null;
  exp?: Experience | '';
  minutes?: (typeof SESSION_MINUTES)[number] | null;
  goal: Goal | '';
  /** Absent counts as `moderate` (the prototype's starting value). */
  pace?: Pace;
  /**
   * Health-check answers by question index 0–5: the prototype's object (`{0:'no', …}`) or an array
   * with `null` for unanswered questions.
   */
  screen?: ScreenAnswers | readonly (ScreenAnswer | null | undefined)[];
}

/**
 * Why a setup step is not complete. One code per prototype message; the app owns the copy.
 * `height_ft_out_of_range` and `height_cm_out_of_range` are the same check, worded per unit.
 */
export type SetupError =
  | 'sex_missing'
  | 'age_missing'
  | 'age_under_min'
  | 'age_over_max'
  | 'height_ft_out_of_range'
  | 'height_cm_out_of_range'
  | 'weight_out_of_range'
  | 'activity_missing'
  | 'days_missing'
  | 'where_missing'
  | 'exp_missing'
  | 'minutes_missing'
  | 'goal_missing'
  | 'screen_incomplete';

/** Daily targets in the contract's `Targets` shape. */
export interface SetupTargets {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** The contract `Profile` fields setup writes (sync metadata excluded). */
export interface SetupProfile {
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;
  activity: Activity;
  where: Where;
  days: number;
  exp: Experience | null;
  minutes: number | null;
  goal: Goal;
  pace: Pace;
  special: Special;
  /** 6 answers in question order. */
  screen: ScreenAnswer[];
  created: string;
  cleared: string | null;
  targets: SetupTargets;
}

/** What `normaliseSetup` carries over from the profile being replaced (redo setup). */
export interface PreviousProfile {
  created?: string | null;
  cleared?: string | null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Feet and inches to cm, unrounded (the value setup validates). Setup stores it rounded to 0.1 cm.
 *
 * Mirrors `(num(v.ft)*12 + num(v.inch)) * 2.54` in prototype `validateStep`.
 */
export function ftInToCm(ft: unknown, inch: unknown): number {
  return (num(ft) * 12 + num(inch)) * 2.54;
}

/**
 * Cm to whole feet and inches (12 in carries to the next foot), for prefilling the form or showing a height.
 *
 * Mirrors prototype `heightText(cm)` and the same steps in `startSetup`.
 */
export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const tin = cm / 2.54;
  let ft = Math.floor(tin / 12);
  let inch = Math.round(tin - ft * 12);
  if (inch === 12) {
    ft++;
    inch = 0;
  }
  return { ft, inch };
}

const heightOf = (a: SetupAnswers): number => (a.unit === 'ft' ? ftInToCm(a.ft, a.inch) : num(a.cm));

/** True when question `i` has a yes/no answer. */
const answered = (screen: SetupAnswers['screen'], i: number): boolean => {
  const v = (screen as Readonly<Record<number, ScreenAnswer | null | undefined>> | undefined)?.[i];
  return v === 'yes' || v === 'no';
};

/**
 * The first problem with one setup step (0–3), or `null` when the step is complete. Steps past 3
 * (the results screen) always pass.
 *
 * Mirrors prototype `validateStep()` with `SU.step` passed in, returning a code instead of the message.
 * The prototype also writes the cleaned values back into `SU.p` here; that half is `normaliseSetup`.
 * The health check counts questions 0–5 answered yes or no (the prototype counts the keys of
 * `p.screen`, which it only ever sets to 0–5 with yes or no).
 */
export function validateSetupStep(step: number, a: SetupAnswers): SetupError | null {
  if (step === 0) {
    if (!a.sex) return 'sex_missing';
    const age = Math.round(num(a.age));
    if (!age) return 'age_missing';
    if (age < AGE_MIN) return 'age_under_min';
    if (age > AGE_MAX) return 'age_over_max';
    const cm = heightOf(a);
    if (cm < HEIGHT_MIN_CM || cm > HEIGHT_MAX_CM) return a.unit === 'ft' ? 'height_ft_out_of_range' : 'height_cm_out_of_range';
    const w = num(a.weight);
    if (w < WEIGHT_MIN_KG || w > WEIGHT_MAX_KG) return 'weight_out_of_range';
  }
  if (step === 1 && !a.activity) return 'activity_missing';
  if (step === 2) {
    if (a.days === null || a.days === undefined) return 'days_missing';
    if (a.days > 0 && !a.where) return 'where_missing';
    if (a.days > 0 && !a.exp) return 'exp_missing';
    if (a.days > 0 && !a.minutes) return 'minutes_missing';
  }
  if (step === 3 && !a.goal) return 'goal_missing';
  if (step === 3) {
    for (let i = 0; i < SCREEN_QUESTIONS; i++) if (!answered(a.screen, i)) return 'screen_incomplete';
  }
  return null;
}

/** The first problem across all four steps, with its step, or `null` when setup is complete. */
export function validateSetup(a: SetupAnswers): { step: number; error: SetupError } | null {
  for (let step = 0; step < SETUP_STEPS; step++) {
    const error = validateSetupStep(step, a);
    if (error) return { step, error };
  }
  return null;
}

/** Contract profile fields → the prototype names `calcTargets` reads. */
export function toTargetsProfile(
  p: Pick<SetupProfile, 'sex' | 'age' | 'height_cm' | 'weight_kg' | 'activity' | 'days' | 'minutes' | 'goal' | 'pace' | 'special'>,
): TargetsProfile {
  return {
    sex: p.sex,
    age: p.age,
    height: p.height_cm,
    weight: p.weight_kg,
    activity: p.activity,
    days: p.days,
    minutes: p.minutes,
    goal: p.goal,
    pace: p.pace,
    special: p.special,
  };
}

/**
 * The profile "Use these targets" saves, in the contract's `Profile` field names, with targets.
 * Throws when the answers do not pass `validateSetup` (the prototype cannot reach this step then).
 *
 * Mirrors the cleaning half of prototype `validateStep()` (age rounded, height to 0.1 cm, weight to
 * 0.1 kg, `special` forced to `none` unless female) and the `su-apply` step of `setupAction`
 * (targets from `calcTargets`; `created` kept from the previous profile, else `today`; `cleared` kept).
 * At 0 days, `exp` and `minutes` are `null`, and `where` is `gym` when not picked (setup does not ask
 * at 0 days), as prototype `validateStep` saves them (#129). Targets read null minutes as 0.
 * Where the contract differs from the prototype's stored object: `screen` is an array of 6, not an
 * object keyed 0–5.
 * Not done here: the prototype also logs `weight` as today's weigh-in when no weights exist yet.
 *
 * @param today `YYYY-MM-DD`, the local date (prototype `TODAY()`).
 */
export function normaliseSetup(a: SetupAnswers, today: string, previous?: PreviousProfile | null): SetupProfile {
  const bad = validateSetup(a);
  if (bad) throw new Error(`normaliseSetup: step ${bad.step}: ${bad.error}`);
  const days = a.days as number;
  const training = days > 0;
  const base = {
    sex: a.sex as Sex,
    age: Math.round(num(a.age)),
    height_cm: Math.round(heightOf(a) * 10) / 10,
    weight_kg: r1(num(a.weight)),
    activity: a.activity as Activity,
    where: a.where || 'gym',
    days,
    exp: training ? (a.exp as Experience) : null,
    minutes: training ? (a.minutes as number) : null,
    goal: a.goal as Goal,
    pace: a.pace ?? 'moderate',
    special: a.sex === 'female' ? (a.special ?? 'none') : 'none',
  } satisfies Omit<SetupProfile, 'screen' | 'created' | 'cleared' | 'targets'>;
  const screen = Array.from({ length: SCREEN_QUESTIONS }, (_, i) => (a.screen as Readonly<Record<number, ScreenAnswer>>)[i] as ScreenAnswer);
  const t = calcTargets(toTargetsProfile(base));
  return {
    ...base,
    screen,
    created: previous?.created || today,
    cleared: previous?.cleared ?? null,
    targets: { kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat },
  };
}

/** Which way the target moves weight. */
export type SetupPace = 'loss' | 'gain' | 'steady';

/** A note under the results, in the order the prototype shows them. */
export type SetupNote = 'special' | 'floored' | 'screen' | 'home_dumbbells' | 'home_bodyweight' | 'older' | 'capped';

/** The numbers and flags of the setup results screen; the app owns the copy. */
export interface SetupSummary {
  /** Full `calcTargets` result (bmr, movement, training, digestion, tdee unrounded; display with `Math.round`). */
  targets: TargetsResult;
  /** "Likely range" low end, TDEE × 0.9, unrounded. */
  burnLow: number;
  /** "Likely range" high end, TDEE × 1.1, unrounded. */
  burnHigh: number;
  /** `Math.round((tdee − kcal) / tdee × 100)`: the deficit percent (negative for a surplus). */
  deficitPct: number;
  /** `loss` when kcal is more than 20 below TDEE, `gain` when more than 20 above, else `steady`. */
  pace: SetupPace;
  /** Kg a week rounded to 0.1, never negative (0 for a change under 0.05 kg): loss for `loss`, gain for `gain`; `null` for `steady`. */
  paceKg: number | null;
  notes: SetupNote[];
}

/**
 * The results screen's values: burn range, pace, deficit percent and which notes show.
 *
 * Mirrors prototype `setupResultHtml()` (profile passed in instead of read from `SU.p`). The
 * "Calories" line under "Why these numbers?" picks deficit or surplus copy from `targets.adj`.
 */
export function setupSummary(
  p: Pick<SetupProfile, 'sex' | 'age' | 'height_cm' | 'weight_kg' | 'activity' | 'where' | 'days' | 'minutes' | 'goal' | 'pace' | 'special' | 'screen'>,
): SetupSummary {
  const r = calcTargets(toTargetsProfile(p));
  const deficitPct = Math.round(((r.tdee - r.kcal) / r.tdee) * 100);
  const pace: SetupPace = r.kcal < r.tdee - PACE_STEADY_KCAL ? 'loss' : r.kcal > r.tdee + PACE_STEADY_KCAL ? 'gain' : 'steady';
  const paceKg = pace === 'loss' ? r1(-r.weekly) : pace === 'gain' ? r1(r.weekly) : null;
  const notes: SetupNote[] = [];
  if (r.special) notes.push('special');
  if (r.floored) notes.push('floored');
  if (screenFlag(p)) notes.push('screen');
  if (p.where && p.where !== 'gym') notes.push(p.where === 'dumbbells' ? 'home_dumbbells' : 'home_bodyweight');
  if (older(p)) notes.push('older');
  if (r.capped) notes.push('capped');
  return { targets: r, burnLow: r.tdee * (1 - BURN_RANGE), burnHigh: r.tdee * (1 + BURN_RANGE), deficitPct, pace, paceKg, notes };
}
