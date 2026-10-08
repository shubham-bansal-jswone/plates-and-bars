import {
  calcTargets,
  num,
  type Activity,
  type Experience,
  type Goal,
  type Pace,
  type ScreenAnswer,
  type Sex,
  type Special,
  type TargetsProfile,
  type Where,
} from '@plate-and-bar/core';
import { SCREEN_Q } from './copy';
import type { Profile } from './types';
import { newId } from '../db/records';

// Answer-collection rules ported from the prototype's `validateStep` and `su-apply`.
// Candidates to move into packages/core (see PR notes); the screens only call these.

export const SESSION_MINUTES = [30, 45, 60, 75, 90] as const;
export const DAY_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export const STEPS = 4;

export interface Draft {
  sex: Sex | '';
  special: Special;
  age: string;
  unit: 'ft' | 'cm';
  ft: string;
  inch: string;
  cm: string;
  weight: string;
  activity: Activity | '';
  where: Where | '';
  days: number | null;
  exp: Experience | '';
  minutes: number | null;
  goal: Goal | '';
  pace: Pace;
  screen: (ScreenAnswer | null)[];
}

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
  screen: SCREEN_Q.map(() => null),
});

const r1 = (n: number) => Math.round(n * 10) / 10;

export const heightCm = (d: Draft): number =>
  d.unit === 'ft' ? (num(d.ft) * 12 + num(d.inch)) * 2.54 : num(d.cm);

/** Error text for a step, or '' when the answers are complete (prototype `validateStep`). */
export function validateStep(step: number, d: Draft): string {
  if (step === 0) {
    if (!d.sex) return 'Choose male or female for the calorie formula.';
    const age = Math.round(num(d.age));
    if (!age) return 'Enter your age.';
    if (age < 18) return 'Plate & Bar is built for adults 18 and over.';
    if (age > 90) return 'Check your age.';
    const cm = heightCm(d);
    if (cm < 120 || cm > 230)
      return d.unit === 'ft' ? 'Enter your height in feet and inches, like 5 and 7.' : 'Enter your height in cm, like 170.';
    const w = num(d.weight);
    if (w < 30 || w > 300) return 'Enter your weight in kg, like 72.5.';
  }
  if (step === 1 && !d.activity) return 'Pick the option closest to a typical weekday.';
  if (step === 2) {
    if (d.days === null) return 'Choose how many sessions you do a week.';
    if (!d.where) return 'Choose where you train.';
    if (d.days > 0 && !d.exp) return 'Choose your training experience.';
    if (d.days > 0 && !d.minutes) return 'Choose a typical session length.';
  }
  if (step === 3 && !d.goal) return 'Choose your main goal.';
  if (step === 3 && d.screen.some((a) => a === null)) return 'Answer the health check questions.';
  return '';
}

/** Today as a local `YYYY-MM-DD`. */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The Profile record for complete, valid answers. Targets come from `calcTargets`. */
export function buildProfile(d: Draft, now: Date): Profile {
  const training = (d.days ?? 0) > 0;
  const base = {
    sex: d.sex as Sex,
    age: Math.round(num(d.age)),
    height_cm: Math.round(heightCm(d) * 10) / 10,
    weight_kg: r1(num(d.weight)),
    activity: d.activity as Activity,
    where: d.where as Where,
    days: d.days ?? 0,
    exp: training ? (d.exp as Experience) : null,
    minutes: training ? d.minutes : null,
    goal: d.goal as Goal,
    pace: d.pace,
    special: d.sex === 'female' ? d.special : ('none' as Special),
    screen: d.screen as ScreenAnswer[],
  };
  const t = calcTargets(toTargetsProfile(base));
  return {
    id: newId(),
    version: 0,
    updated_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    deleted_at: null,
    ...base,
    created: localDate(now),
    cleared: null,
    targets: { kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat },
  };
}

type TargetsSource = Pick<
  Profile,
  'sex' | 'age' | 'height_cm' | 'weight_kg' | 'activity' | 'days' | 'minutes' | 'goal' | 'pace' | 'special'
>;

/** Contract Profile fields to the names `calcTargets` reads. */
export const toTargetsProfile = (p: TargetsSource): TargetsProfile => ({
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
});
