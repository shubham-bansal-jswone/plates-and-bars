import {
  SCREEN_QUESTIONS,
  normaliseSetup,
  validateSetupStep,
  type ScreenAnswer,
  type SetupAnswers,
  type SetupError,
  type Special,
  type Pace,
} from '@plate-and-bar/core';
import type { Profile } from './types';

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

// One message per core error code (prototype `validateStep` texts).
const ERROR_COPY: Record<SetupError, string> = {
  sex_missing: 'Choose male or female for the calorie formula.',
  age_missing: 'Enter your age.',
  age_under_min: 'Plate & Bar is built for adults 18 and over.',
  age_over_max: 'Check your age.',
  height_ft_out_of_range: 'Enter your height in feet and inches, like 5 and 7.',
  height_cm_out_of_range: 'Enter your height in cm, like 170.',
  weight_out_of_range: 'Enter your weight in kg, like 72.5.',
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

/** Today as a local `YYYY-MM-DD` (the format core's `normaliseSetup` takes). */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The Profile record for complete answers: core's `normaliseSetup` plus local sync metadata. */
export function buildProfile(d: Draft, now: Date): Profile {
  return {
    id: null,
    version: 0,
    updated_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    deleted_at: null,
    ...normaliseSetup(d, localDate(now)),
  };
}
