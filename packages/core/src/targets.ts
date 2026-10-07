import { num } from './num';

export type Sex = 'male' | 'female';
export type Activity = 'sitting' | 'light' | 'feet' | 'physical';
export type Goal = 'lose' | 'recomp' | 'maintain' | 'gain';
export type Pace = 'gentle' | 'moderate';
export type Special = 'none' | 'pregnant' | 'breastfeeding';

/** The setup answers `calcTargets` reads. Height in cm, weight in kg. */
export interface TargetsProfile {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  activity: Activity;
  /** Sessions a week, 0–7. `null` (not answered) counts as 0, as in the prototype. */
  days: number | null;
  /** Session length in minutes. `null` counts as 0. */
  minutes: number | null;
  goal: Goal;
  /** Defaults to `moderate` when absent. Only read when `goal` is `lose`. */
  pace?: Pace;
  /**
   * Pregnancy / breastfeeding. Only counts for `sex: 'female'`. `null` and `''` (possible in
   * untyped stored or synced JSON) count as `'none'`, as in the prototype.
   */
  special?: Special | null | '';
}

/**
 * Full result of `calcTargets`, unrounded where the prototype leaves values
 * unrounded (bmr, movement, training, digestion, tdee, bmi, weekly). Round for
 * display with `Math.round`, as the prototype's `fmt` does.
 */
export interface TargetsResult {
  /** Weight used, kg. */
  w: number;
  bmr: number;
  movement: number;
  training: number;
  digestion: number;
  tdee: number;
  /** Daily kcal target, rounded to 10. */
  kcal: number;
  /** Goal adjustment as a fraction of TDEE (e.g. -0.2). */
  adj: number;
  capped: boolean;
  /** Minimum target for this sex (1500 men, 1200 women). */
  floor: number;
  floored: boolean;
  /** True for women who are pregnant or breastfeeding. */
  special: boolean;
  bmi: number;
  /** Reference weight for protein: BMI-27 weight (rounded to kg) when BMI > 30, else `w`. */
  refW: number;
  perKg: number;
  /** Grams, rounded to 5. */
  protein: number;
  /** Grams, rounded to 1. */
  fat: number;
  /** Grams, rounded to 1, never negative. */
  carbs: number;
  /** Expected weight change, kg per week (negative is loss). */
  weekly: number;
}

/** Mirrors prototype `ACTIVITY[...].m`: non-exercise movement as a fraction of BMR. */
export const ACTIVITY_MULTIPLIER: Readonly<Record<Activity, number>> = {
  sitting: 0.15,
  light: 0.3,
  feet: 0.45,
  physical: 0.6,
};

/** Mirrors prototype `PACE[...].adj`. */
export const PACE_ADJ: Readonly<Record<Pace, number>> = {
  gentle: -0.15,
  moderate: -0.2,
};

/** Mirrors prototype `TRAIN_NET_MET`: ~5 METs lifting incl. rest, minus resting 1 MET. */
export const TRAIN_NET_MET = 4;

/**
 * Mifflin-St Jeor resting energy, kcal/day.
 *
 * Mirrors prototype `bmrOf(p, w)`.
 */
export function bmrOf(p: Pick<TargetsProfile, 'sex' | 'age' | 'height'>, w: number): number {
  return 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}

/**
 * Daily calorie and macro targets from the setup answers.
 *
 * Mirrors prototype `calcTargets(p)` exactly, including where it rounds and where it does not.
 */
export function calcTargets(p: TargetsProfile): TargetsResult {
  const w = num(p.weight);
  const hM = p.height / 100;
  const bmr = bmrOf(p, w);
  const movement = bmr * ACTIVITY_MULTIPLIER[p.activity];
  const training = (num(p.days) * (num(p.minutes) / 60) * TRAIN_NET_MET * w) / 7;
  const base = bmr + movement + training;
  const tdee = base / 0.9;
  const digestion = tdee - base;
  const special = p.sex === 'female' && !!p.special && p.special !== 'none';
  let adj =
    p.goal === 'lose'
      ? PACE_ADJ[p.pace ?? 'moderate']
      : p.goal === 'recomp'
        ? -0.1
        : p.goal === 'gain'
          ? 0.07
          : 0;
  if (special && adj < 0) adj = 0;
  let kcal = tdee * (1 + adj);
  let capped = false;
  let floored = false;
  if (adj < 0 && tdee - kcal > 750) {
    kcal = tdee - 750;
    capped = true;
  }
  const floor = p.sex === 'male' ? 1500 : 1200;
  if (adj < 0 && kcal < floor) {
    kcal = Math.min(floor, tdee);
    floored = true;
  }
  kcal = Math.round(kcal / 10) * 10;
  const bmi = w / (hM * hM);
  const refW = bmi > 30 ? Math.round(27 * hM * hM) : w;
  const perKg = (p.goal === 'lose' || p.goal === 'recomp') && !special ? 2.0 : 1.8;
  const protein = Math.round((refW * perKg) / 5) * 5;
  const fat = Math.max(Math.round((kcal * 0.25) / 9), Math.round(0.6 * w));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const weekly = ((kcal - tdee) * 7) / 7700;
  return { w, bmr, movement, training, digestion, tdee, kcal, adj, capped, floor, floored, special, bmi, refW, perKg, protein, fat, carbs, weekly };
}
