import { addDays } from './dates';
import { num } from './num';
import type { Sex } from './targets';

/**
 * Progress formulas (PROTOTYPE_SPEC section 6): body measures and day targets. Weigh-ins come in the
 * contract's `Weight` shape, tape measurements in `Measurement`, day notes in `DayNote` and sets in
 * `WorkoutSet`; records with `deleted_at` set are left out. Each type lists only the fields read.
 */

/** A weigh-in (contract `Weight`; prototype `weights.entries[date]`). */
export interface WeighIn {
  date: string;
  weight_kg: number;
  deleted_at?: string | null | undefined;
}

/** Tape measurements on a day (contract `Measurement`; prototype `measures.entries[date]`), in cm. */
export interface MeasurementFacts {
  date: string;
  waist_cm?: number | null | undefined;
  neck_cm?: number | null | undefined;
  chest_cm?: number | null | undefined;
  arm_cm?: number | null | undefined;
  thigh_cm?: number | null | undefined;
  hips_cm?: number | null | undefined;
  deleted_at?: string | null | undefined;
}

/** A measured part: a `MeasurementFacts` key (prototype `MEASURES` keys with `_cm`). */
export type MeasureKey = 'waist_cm' | 'neck_cm' | 'chest_cm' | 'arm_cm' | 'thigh_cm' | 'hips_cm';

/** What `stepsTarget` reads from a day (contract `DayNote`). */
export interface StepsDay {
  date: string;
  steps?: number | null | undefined;
  deleted_at?: string | null | undefined;
}

/** What `workoutBurn` reads from a set (contract `WorkoutSet`). */
export interface BurnSet {
  /** Only `work` sets count; ramp sets are not in the prototype's `ex.sets`. */
  kind?: 'work' | 'ramp' | undefined;
  done: boolean;
  /** When the set was ticked (contract Timestamp; prototype `Date.now()` ms). */
  t?: string | null | undefined;
  deleted_at?: string | null | undefined;
}

const live = <T extends { deleted_at?: string | null | undefined }>(xs: readonly T[]): T[] => xs.filter((x) => x.deleted_at == null);

/**
 * The latest weigh-in on or before `upTo` (any date when `upTo` is omitted), or null.
 *
 * Mirrors prototype `latestWeight(upTo)`.
 */
export function latestWeight(weighIns: readonly WeighIn[], upTo?: string): number | null {
  let best: WeighIn | null = null;
  for (const w of live(weighIns)) if ((!upTo || w.date <= upTo) && (!best || w.date >= best.date)) best = w;
  return best ? best.weight_kg : null;
}

/**
 * The latest nonzero `key` measurement on or before `upTo`, with its date, or null.
 *
 * Mirrors prototype `measureAt(key, upTo)`.
 */
export function measureAt(measurements: readonly MeasurementFacts[], key: MeasureKey, upTo: string): { date: string; v: number } | null {
  let best: { date: string; v: number } | null = null;
  for (const m of live(measurements)) {
    const v = m[key];
    if (m.date <= upTo && v && (!best || m.date >= best.date)) best = { date: m.date, v };
  }
  return best;
}

/** What `navyBodyFat` reads from the profile (contract `Profile`). */
export interface NavyProfile {
  sex: Sex;
  height_cm: number;
}

/**
 * US Navy body-fat estimate in percent, unrounded (show to 0.1, as prototype `r1`), from the latest
 * waist and neck (and hips for women) on or before `upTo`. Null with no profile or height, a missing
 * measurement, a non-positive log argument, or a result outside 2–70 %.
 *
 * Mirrors prototype `navyBF(upTo)`.
 */
export function navyBodyFat(profile: NavyProfile | null | undefined, measurements: readonly MeasurementFacts[], upTo: string): number | null {
  if (!profile || !profile.height_cm) return null;
  const w = measureAt(measurements, 'waist_cm', upTo), n = measureAt(measurements, 'neck_cm', upTo), h = measureAt(measurements, 'hips_cm', upTo);
  if (!w || !n) return null;
  let bf: number;
  if (profile.sex === 'male') {
    if (w.v - n.v <= 0) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(w.v - n.v) + 0.15456 * Math.log10(profile.height_cm)) - 450;
  } else {
    if (!h || w.v + h.v - n.v <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(w.v + h.v - n.v) + 0.221 * Math.log10(profile.height_cm)) - 450;
  }
  return bf > 2 && bf < 70 ? bf : null;
}

/** Water target with no weight known, in ml (prototype `waterTarget`'s 2500). */
export const WATER_DEFAULT_ML = 2500;
/** Water per kg of bodyweight, in ml (prototype `waterTarget`'s 33). */
export const WATER_ML_PER_KG = 33;
/** Extra water on a training day, in ml (prototype `waterTarget`'s 600). */
export const WATER_TRAINING_ML = 600;

/** What `waterTarget` reads. */
export interface WaterInput {
  /** The day shown (prototype `S.date`). */
  date: string;
  weighIns: readonly WeighIn[];
  /** Profile weight (contract `Profile.weight_kg`), used when there is no weigh-in up to `date`. */
  profileWeightKg?: number | null | undefined;
  /** Any set of the day's workout ticked done. */
  anySetDone: boolean;
  /** The day's planned template (`planned(date, state)`); a training day when not null. */
  planned: string | null | undefined;
}

/**
 * The day's water target: 33 ml per kg (latest weigh-in up to the day, else the profile weight),
 * rounded to 100 ml, or 2,500 ml with neither; plus 600 ml when a set is done or a session is planned.
 *
 * Mirrors prototype `waterTarget()` (state passed in).
 */
export function waterTarget(i: WaterInput): { ml: number; trained: boolean } {
  const w = latestWeight(i.weighIns, i.date) || i.profileWeightKg || 0;
  let ml = w ? Math.round((w * WATER_ML_PER_KG) / 100) * 100 : WATER_DEFAULT_ML;
  const trained = i.anySetDone || !!i.planned;
  if (trained) ml += WATER_TRAINING_ML;
  return { ml, trained };
}

/** Result of `workoutBurn`. */
export interface WorkoutBurn {
  /** Sets ticked done. */
  sets: number;
  /** Session minutes, rounded. */
  min: number;
  /** Cardio minutes as entered. */
  cardio: number;
  /** Gross kcal at 5 METs, to the nearest 5. */
  gross: number;
  /** Kcal over resting (4 METs net), to the nearest 5: what the day's burn adds. */
  extra: number;
  /** Whether the time came from 2 or more tick times (else about 3 min per set). */
  timed: boolean;
}

/**
 * Rough workout burn: lifting time from the first to the last ticked set plus 3 minutes (with fewer
 * than 2 tick times, 3 minutes per set), capped at the larger of 6 minutes per set and 10 minutes;
 * lifting and cardio at 5 METs gross, 4 METs over resting, each rounded to 5 kcal.
 *
 * Mirrors prototype `workoutBurn(w, kg)` (the workout's sets and `cardio_min` passed in).
 */
export function workoutBurn(sets: readonly BurnSet[], cardioMin: number | null | undefined, kg: number): WorkoutBurn {
  const done = live(sets).filter((s) => s.done && (s.kind ?? 'work') === 'work');
  const ts = done.map((s) => (s.t ? Date.parse(s.t) : 0)).filter(Boolean);
  let min = ts.length >= 2 ? (Math.max(...ts) - Math.min(...ts)) / 60000 + 3 : done.length * 3;
  min = Math.min(min, Math.max(done.length * 6, 10));
  const cardio = num(cardioMin), liftH = done.length ? min / 60 : 0;
  const gross = Math.round((5 * kg * liftH + (5 * kg * cardio) / 60) / 5) * 5;
  const extra = Math.round((4 * kg * liftH + (4 * kg * cardio) / 60) / 5) * 5;
  return { sets: done.length, min: Math.round(min), cardio, gross, extra, timed: ts.length >= 2 };
}

/** Steps target with fewer than 3 days of steps in the last week (prototype `stepsTarget`'s 7000). */
export const STEPS_DEFAULT = 7000;
/** Steps target bounds (prototype `stepsTarget`'s 5000 and 12000). */
export const STEPS_MIN = 5000;
export const STEPS_MAX = 12000;

/**
 * Steps target for `date`: the average of the 7 days before it with steps above 0, plus 1,000,
 * rounded to 500, kept within 5,000–12,000; 7,000 with fewer than 3 such days.
 *
 * Mirrors prototype `stepsTarget()` (days passed in instead of loaded).
 */
export function stepsTarget(days: readonly StepsDay[], date: string): number {
  const from = addDays(date, -7);
  const st = live(days).filter((d) => d.date >= from && d.date < date).map((d) => num(d.steps)).filter((x) => x > 0);
  if (st.length < 3) return STEPS_DEFAULT;
  const avg = st.reduce((a, b) => a + b, 0) / st.length;
  return Math.min(STEPS_MAX, Math.max(STEPS_MIN, Math.round((avg + 1000) / 500) * 500));
}

/** How far the latest weigh-in must be from the setup weight to offer "Recalculate" (prototype's 2 kg). */
export const WEIGHT_DRIFT_KG = 2;

/** Result of `weightDrift` when the targets should be recalculated. */
export interface WeightDrift {
  /** Latest weigh-in, kg (show to 0.1). */
  latest: number;
  /** Distance from the setup weight, kg, never negative (show to 0.1). */
  diff: number;
  /** Whether the latest weigh-in is below the setup weight. */
  lower: boolean;
}

/**
 * Whether the Targets screen offers "Recalculate targets": the latest weigh-in (any date) is at least
 * 2 kg from the setup weight. Null otherwise, or with no weigh-in. "Recalculate" starts setup with the
 * latest weigh-in as the weight (`latestWeight(weighIns)`), as prototype `startSetup` does.
 *
 * Mirrors the `drift` check and note in prototype `setupSummaryHtml()` (#161).
 */
export function weightDrift(weighIns: readonly WeighIn[], setupWeightKg: number): WeightDrift | null {
  const lw = latestWeight(weighIns);
  if (!lw || !(Math.abs(lw - setupWeightKg) >= WEIGHT_DRIFT_KG)) return null;
  return { latest: lw, diff: Math.abs(lw - setupWeightKg), lower: lw < setupWeightKg };
}
