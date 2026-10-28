import {
  SCREEN_QUESTIONS,
  cmToFtIn,
  normaliseSetup,
  validateSetupStep,
  type ScreenAnswer,
  type SetupAnswers,
  type SetupError,
  type Special,
  type Pace,
  type WeightUnit,
} from '@plate-and-bar/core';
import type { Profile } from './types';
import { weightFieldText } from '../workout/unitText';

// Form state and the mapping to storage. Validation, cleaning, targets and the choice lists all come
// from packages/core (`validateSetupStep`, `normaliseSetup`, `DAY_CHOICES`, ...); nothing is decided here.

/** Setup form state: core's `SetupAnswers` with the optional fields always present. */
export type Draft = SetupAnswers & {
  special: Special;
  pace: Pace;
  where: NonNullable<SetupAnswers['where']>;
  exp: NonNullable<SetupAnswers['exp']>;
  minutes: NonNullable<SetupAnswers['minutes']> | null;
  ft: string;
  inch: string;
  cm: string;
  age: string;
  weight: string;
  screen: (ScreenAnswer | null)[];
};

export const emptyDraft = (): Draft => ({
  sex: '',
  special: 'none',
  age: '',
  unit: 'ft',
  ft: '',
  inch: '',
  cm: '',
  weight: '',
  activity: '',
  where: '',
  days: null,
  exp: '',
  minutes: null,
  goal: '',
  pace: 'moderate',
  screen: Array.from({ length: SCREEN_QUESTIONS }, () => null),
});

/** The weight message names the unit the box is typed in. */
function weightError(unit: WeightUnit): string {
  return `Enter your weight in ${unit}, like ${unit === 'lb' ? '160' : '72.5'}.`;
}

// One message per core error code (prototype `validateStep` texts).
const ERROR_COPY: Record<SetupError, string> = {
  sex_missing: 'Choose male or female for the calorie formula.',
  age_missing: 'Enter your age.',
  age_under_min: 'Plate & Bar is built for adults 18 and over.',
  age_over_max: 'Check your age.',
  height_ft_out_of_range: 'Enter your height in feet and inches, like 5 and 7.',
  height_cm_out_of_range: 'Enter your height in cm, like 170.',
  weight_out_of_range: weightError('kg'),
  activity_missing: 'Pick the option closest to a typical weekday.',
  days_missing: 'Choose how many sessions you do a week.',
  where_missing: 'Choose where you train.',
  exp_missing: 'Choose your training experience.',
  minutes_missing: 'Choose a typical session length.',
  goal_missing: 'Choose your main goal.',
  screen_incomplete: 'Answer the health check questions.',
};

/** Error text for a step, or '' when the step is complete. */
export function validateStep(step: number, d: Draft): string {
  const e = validateSetupStep(step, d);
  return e ? ERROR_COPY[e] : '';
}

/** The form field an error belongs to, so the UI shows it under that field. */
export type SetupField = 'sex' | 'age' | 'height' | 'weight' | 'activity' | 'days' | 'where' | 'exp' | 'minutes' | 'goal' | 'screen';

const FIELD_OF: Record<SetupError, SetupField> = {
  sex_missing: 'sex',
  age_missing: 'age',
  age_under_min: 'age',
  age_over_max: 'age',
  height_ft_out_of_range: 'height',
  height_cm_out_of_range: 'height',
  weight_out_of_range: 'weight',
  activity_missing: 'activity',
  days_missing: 'days',
  where_missing: 'where',
  exp_missing: 'exp',
  minutes_missing: 'minutes',
  goal_missing: 'goal',
  screen_incomplete: 'screen',
};

const FIX: Record<SetupField, Partial<Draft>> = {
  sex: { sex: 'male' },
  age: { age: '30' },
  height: { unit: 'cm', cm: '170' },
  weight: { weight: '100' },
  activity: { activity: 'sitting' },
  days: { days: 0 },
  where: { where: 'gym' },
  exp: { exp: 'new' },
  minutes: { minutes: 30 },
  goal: { goal: 'maintain' },
  screen: { screen: Array.from({ length: SCREEN_QUESTIONS }, () => 'no' as const) },
};

/**
 * Every invalid field of a step with its message, in form order (empty when complete). Core reports one error at a time,
 * so each found field is filled with a valid stand-in on a copy and core is asked again.
 */
export function stepErrors(step: number, d: Draft, unit: WeightUnit = 'kg'): [SetupField, string][] {
  const out: [SetupField, string][] = [];
  let cur = d;
  for (let e = validateSetupStep(step, cur, unit); e; e = validateSetupStep(step, cur, unit)) {
    if (out.some(([f]) => f === FIELD_OF[e])) break; // a stand-in core still rejects: stop, never loop
    out.push([FIELD_OF[e], e === 'weight_out_of_range' ? weightError(unit) : ERROR_COPY[e]]);
    cur = { ...cur, ...FIX[FIELD_OF[e]] };
  }
  return out;
}

/** Today as a local `YYYY-MM-DD` (the format core's `normaliseSetup` takes). */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The form filled with a stored profile's answers (prototype `startSetup` on a redo); height shows in ft/in, as first time (`keepStoredHeight` keeps the stored cm if it is not edited). */
export function draftFromProfile(p: Profile, unit: WeightUnit = 'kg'): Draft {
  const { ft, inch } = cmToFtIn(p.height_cm);
  return {
    sex: p.sex,
    special: p.special,
    age: String(p.age),
    unit: 'ft',
    ft: String(ft),
    inch: String(inch),
    cm: String(Math.round(p.height_cm)),
    weight: weightFieldText(String(p.weight_kg), unit),
    activity: p.activity,
    where: p.where,
    // Both came through core's validation when stored.
    days: p.days as Draft['days'],
    exp: p.exp ?? '',
    minutes: p.minutes as Draft['minutes'],
    goal: p.goal,
    pace: p.pace,
    screen: [...p.screen],
  };
}

/**
 * Any redo keeps the stored height (it was first the prototype `su-recalc` rule; now it applies to every redo, see #1224):
 * when the height fields still hold what `draftFromProfile` filled in, the answers carry the stored cm instead of the
 * rounded feet and inches. Once any height field is edited, the form's height is used.
 */
export function keepStoredHeight(d: Draft, stored: Profile): Draft {
  const filled = draftFromProfile(stored);
  const same = d.unit === 'ft' ? d.ft === filled.ft && d.inch === filled.inch : d.cm === filled.cm; // only the fields shown
  return same ? { ...d, unit: 'cm', cm: String(stored.height_cm) } : d;
}

/** The Profile record for complete answers: core's `normaliseSetup` plus local sync metadata. A redo keeps `created` and `cleared`. */
export function buildProfile(d: Draft, now: Date, previous?: Profile | null, unit: WeightUnit = 'kg', exactKg?: number): Profile {
  return {
    id: null,
    version: 0,
    updated_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    deleted_at: null,
    ...normaliseSetup(d, localDate(now), previous, unit, exactKg),
  };
}

/**
 * The kg to keep as it is when the weight box still shows what the stored kg `source` (the profile's, or the latest weigh-in) reads as in lb:
 * a weight shown in lb and left alone is never re-saved from rounded lb text. Undefined for kg (core rounds the typed number as ever) and when edited.
 */
export function unchangedKg(d: Draft, unit: WeightUnit, source: number | null | undefined): number | undefined {
  return unit === 'lb' && source != null && d.weight === weightFieldText(String(source), unit) ? source : undefined;
}
