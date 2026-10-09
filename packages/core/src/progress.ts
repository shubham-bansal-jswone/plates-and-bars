import { addDays, daysBetween, mondayOf } from './dates';
import { dayComplete, logTotals, type FoodLogFacts } from './food';
import { num } from './num';
import { planList, splitFor, type PlanProfile, type SessionLog, type WeekPlan } from './plan';
import type { LiftRecord } from './progression';
import { toTargetsProfile, type SetupProfile } from './setup';
import { stalledList } from './stalls';
import { calcTargets, type Sex } from './targets';

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
 * 2 kg from the setup weight, comparing the gap rounded to 0.1 kg as the note shows it, so 64.1 vs
 * 62.1 (1.999… in floating point) counts (#209). Null otherwise, or with no weigh-in. "Recalculate" starts setup with the
 * latest weigh-in as the weight (`latestWeight(weighIns)`), as prototype `startSetup` does.
 *
 * Mirrors the `drift` check and note in prototype `setupSummaryHtml()` (#161).
 */
export function weightDrift(weighIns: readonly WeighIn[], setupWeightKg: number): WeightDrift | null {
  const lw = latestWeight(weighIns);
  if (!lw || !(Math.round(Math.abs(lw - setupWeightKg) * 10) / 10 >= WEIGHT_DRIFT_KG)) return null;
  return { latest: lw, diff: Math.abs(lw - setupWeightKg), lower: lw < setupWeightKg };
}

/* ---------- real burn, rapid loss, habits, weekly check-in ---------- */

/** Kcal per kg of body weight (prototype `KCAL_PER_KG`). */
export const KCAL_PER_KG = 7700;
/** Calories added when weight drops fast (prototype `calorieCard`'s 150). */
export const RAPID_LOSS_KCAL = 150;
/** Minimum change before the check-in suggests a new calorie target (prototype `renderCheckin`'s 100). */
export const CHECKIN_KCAL_STEP = 100;
/** WHO weekly moderate-activity minutes (prototype `renderCheckin`'s "of 150 min"). */
export const CARDIO_WEEK_MIN = 150;

/** One day's facts for the check-in, habits and real burn (one per date; a missing date is a blank day). */
export interface ProgressDay {
  date: string;
  /** That day's food logs (contract `FoodLog`). */
  logs: readonly FoodLogFacts[];
  /** Contract `DayNote.complete`, `steps`, `sleep`. */
  complete?: boolean | null | undefined;
  steps?: number | null | undefined;
  sleep?: number | null | undefined;
  /** Contract `Workout.cardio_min`. */
  cardioMin?: number | null | undefined;
  /** Any work set of the day's workout ticked done. */
  trained: boolean;
}

const BLANK = (date: string): ProgressDay => ({ date, logs: [], trained: false });

/** The `n` days ending on `end`, oldest first, as prototype `loadDays(end, n)` gives them. */
function daysEnding(days: readonly ProgressDay[], end: string, n: number): ProgressDay[] {
  return Array.from({ length: n }, (_, k) => {
    const d = addDays(end, k - n + 1);
    return days.find((x) => x.date === d) ?? BLANK(d);
  });
}

function entries(weighIns: readonly WeighIn[]): Map<string, number> {
  return new Map(live(weighIns).map((w) => [w.date, w.weight_kg]));
}

/**
 * Average of the weigh-ins in the 7 days ending on `end`, or null with fewer than 3.
 *
 * Mirrors prototype `weeklyAvg(end)`.
 */
export function weeklyAvg(weighIns: readonly WeighIn[], end: string): number | null {
  const e = entries(weighIns), v: number[] = [];
  for (let i = 0; i < 7; i++) {
    const w = e.get(addDays(end, -i));
    if (w) v.push(w);
  }
  return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Result of `rapidLoss`: the "Weight is dropping fast" card. */
export interface RapidLoss {
  /** Dismissal key, `kcal:<Monday>`. */
  key: string;
  /** This week's average below last week's, kg (show to 0.1). */
  drop: number;
  /** Over 1% a week for 2 weeks running; otherwise 1 week plus 2 or more stalled lifts. */
  twoWeeks: boolean;
  stalls: number;
}

/**
 * Whether to suggest adding `RAPID_LOSS_KCAL`: the weekly average fell more than 1% this week and the
 * week before, or this week with 2 or more stalled lifts. `today` is the real today (prototype `TODAY()`);
 * `stalls` is `stalledList(lifts, date).length`. The app hides the card when muted or dismissed.
 *
 * Mirrors prototype `calorieCard()`.
 */
export function rapidLoss(weighIns: readonly WeighIn[], today: string, stalls: number): RapidLoss | null {
  const w1 = weeklyAvg(weighIns, today), w0 = weeklyAvg(weighIns, addDays(today, -7)), w2 = weeklyAvg(weighIns, addDays(today, -14));
  const fast1 = !!w1 && !!w0 && w0 - w1 > 0.01 * w0, fast2 = fast1 && !!w2 && w2 - (w0 as number) > 0.01 * w2;
  if (!fast2 && !(fast1 && stalls >= 2)) return null;
  return { key: 'kcal:' + mondayOf(today), drop: (w0 as number) - (w1 as number), twoWeeks: fast2, stalls };
}

/**
 * New calorie and carb targets after "Add 150 kcal" (or any change `v`): calories never below 1,200,
 * carbs change by `v / 4` g, never below 0.
 *
 * Mirrors the `adj-kcal` step of prototype `adjAction`.
 */
export function addKcal(t: { kcal: number; carbs: number }, v: number): { kcal: number; carbs: number } {
  return { kcal: Math.max(1200, t.kcal + v), carbs: Math.max(0, t.carbs + Math.round(v / 4)) };
}

/**
 * Least-squares weight trend in kg per day over the `span` days ending on `end` (`slope` only with 6
 * or more weigh-ins; 0 if they share one day).
 *
 * Mirrors prototype `weightSlope(end, span)`.
 */
export function weightSlope(weighIns: readonly WeighIn[], end: string, span: number): { n: number; slope?: number } {
  const start = addDays(end, -span);
  const e = [...entries(weighIns)].filter(([d]) => d <= end && d > start);
  if (e.length < 6) return { n: e.length };
  const xs = e.map(([d]) => daysBetween(start, d)), ys = e.map(([, v]) => v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let nu = 0, den = 0;
  xs.forEach((x, i) => {
    nu += (x - mx) * ((ys[i] as number) - my);
    den += (x - mx) * (x - mx);
  });
  return { n: e.length, slope: den ? nu / den : 0 };
}

/** Real-burn state kept between check-ins (contract `Settings.adaptive`; prototype `settings.adaptive`). */
export interface AdaptiveState {
  /** Monday of the week `value` was last set. */
  week?: string | null | undefined;
  /** Last week's estimate. */
  prev?: number | null | undefined;
  /** The latest estimate. */
  value?: number | null | undefined;
}

/** Result of `adaptiveBurn`. */
export type AdaptiveBurn =
  | { ready: false; needDays: number; needW: number }
  | { ready: true; intake: number; slope: number; raw: number; burn: number; logged: number };

/**
 * Real burn: average intake on complete days with food in the 14 days ending on `date`, minus the
 * 21-day weight slope × 7,700, smoothed 60/40 with last week's estimate and rounded. Needs 10 such
 * days and 6 weigh-ins. `kcalTarget` is the settings target, for `dayComplete`.
 *
 * Mirrors prototype `adaptiveBurn(days)` (days, weigh-ins and state passed in).
 */
export function adaptiveBurn(days: readonly ProgressDay[], weighIns: readonly WeighIn[], date: string, kcalTarget: number, adaptive: AdaptiveState | null | undefined): AdaptiveBurn {
  const logged = daysEnding(days, date, 14).filter((d) => live(d.logs).length && dayComplete(d, d.logs, kcalTarget));
  const ws = weightSlope(weighIns, date, 21);
  const needDays = Math.max(0, 10 - logged.length), needW = Math.max(0, 6 - ws.n);
  if (needDays || needW) return { ready: false, needDays, needW };
  const intake = logged.reduce((a, d) => a + logTotals(d.logs, []).kcal, 0) / logged.length;
  const slope = ws.slope as number, raw = intake - slope * KCAL_PER_KG, AD = adaptive ?? {};
  const prev = AD.week === mondayOf(date) ? AD.prev : AD.value;
  return { ready: true, intake, slope, raw, burn: Math.round(prev ? 0.6 * prev + 0.4 * raw : raw), logged: logged.length };
}

/**
 * The real-burn state to save after a ready estimate: on a new week last week's value moves to `prev`.
 *
 * Mirrors the `S.settings.adaptive` update in prototype `renderCheckin()`.
 */
export function nextAdaptive(adaptive: AdaptiveState | null | undefined, date: string, burn: number): AdaptiveState {
  const AD = { ...adaptive };
  if (AD.week !== mondayOf(date)) {
    AD.prev = AD.value || null;
    AD.week = mondayOf(date);
  }
  AD.value = burn;
  return AD;
}

/** What `targetFromBurn` reads from the profile (contract `Profile`). */
export type BurnProfile = Pick<SetupProfile, 'sex' | 'age' | 'height_cm' | 'weight_kg' | 'activity' | 'days' | 'minutes' | 'goal' | 'pace' | 'special'>;

/**
 * Targets from a real burn: the goal's adjustment, the 750 kcal cap and the floor as in `calcTargets`,
 * to 10 kcal; protein kept; fat the larger of 25% and 0.6 g per kg (latest weigh-in, else profile
 * weight); carbs the rest. Null with no profile.
 *
 * Mirrors prototype `targetFromBurn(burn)`.
 */
export function targetFromBurn(burn: number, profile: BurnProfile | null | undefined, weighIns: readonly WeighIn[], protein: number): { kcal: number; protein: number; fat: number; carbs: number } | null {
  if (!profile) return null;
  const r = calcTargets(toTargetsProfile(profile)), adj = r.adj;
  let kcal = burn * (1 + adj);
  if (adj < 0 && burn - kcal > 750) kcal = burn - 750;
  if (adj < 0 && kcal < r.floor) kcal = Math.min(r.floor, burn);
  kcal = Math.round(kcal / 10) * 10;
  const w = latestWeight(weighIns) || profile.weight_kg;
  const fat = Math.max(Math.round((kcal * 0.25) / 9), Math.round(0.6 * w)), carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs };
}

/** What the weekly check-in reads. */
export interface CheckinInput {
  /** The day shown (prototype `S.date`); the week is the 7 days ending on it. */
  date: string;
  /** At least the 21 days ending on `date`. */
  days: readonly ProgressDay[];
  weighIns: readonly WeighIn[];
  lifts: Readonly<Record<string, LiftRecord>>;
  /** Settings targets (prototype `S.settings.kcal`, `.protein`). */
  kcal: number;
  protein: number;
  profile: BurnProfile | null | undefined;
  adaptive?: AdaptiveState | null | undefined;
  /** Prototype `adj.weekPlan`, `adj.dismissed`, `adj.muted`. */
  weekPlan?: WeekPlan | null | undefined;
  dismissed?: Readonly<Record<string, boolean>> | undefined;
  muted?: Readonly<Record<string, boolean>> | undefined;
}

/** The check-in's one suggestion, if any. */
export type CheckinSuggestion =
  | { kind: 'kcal'; target: { kcal: number; protein: number; fat: number; carbs: number } }
  | { kind: 'week' }
  | { kind: 'protein' };

/** The weekly check-in's facts (prototype `S.ciData` plus the cardio, steps, sleep and burn lines). */
export interface WeeklyCheckin {
  /** Dismissal key, `ci:<Monday>`. */
  key: string;
  sessions: number;
  /** This week's plan length, else the profile's plan (`planList`; 6 with no profile, 0 at 0 days) (#215). */
  plannedN: number;
  /** Days with food logged, of 7. */
  logged: number;
  /** Averages over days with food (0 with none); `pDays` = days at 90% of the protein target or more. */
  avgK: number;
  avgP: number;
  pDays: number;
  /** This and last week's average weight. */
  w1: number | null;
  w0: number | null;
  /** Week-on-week change in average weight (`|w1 - w0|`, down when `w1 <= w0`); null unless both weeks have one (#264). */
  weeklyChange: { amount: number; down: boolean } | null;
  /** Lifts whose best score this week beat earlier ones by more than 1%, best first, top 3. */
  improved: { n: string; pct: number }[];
  /** Stalled lifts, top 3. */
  stalled: string[];
  /** Cardio minutes this week, of `CARDIO_WEEK_MIN`. */
  cardioMin: number;
  /** Average steps and sleep over days with a value above 0, or null. */
  steps: number | null;
  sleep: number | null;
  /** Average sleep under 7 hours a night, below the 7–9 hours the check-in recommends (#264). */
  sleepShort: boolean;
  burn: AdaptiveBurn;
  /** The real-burn weight trend in kg a week (`burn.slope × 7`, negative is down), or null until the burn is ready (#264). */
  slopePerWeek: number | null;
  /** Setup formula burn (`calcTargets` tdee), or null with no profile. */
  formula: number | null;
  suggestion: CheckinSuggestion | null;
}

/**
 * The weekly check-in for the 7 days ending on `date`.
 *
 * The shorter-week suggestion (a 4-day plan next week) needs more than 4 planned sessions,
 * `sessions + 2 <= plannedN` and no current or future week plan; a past week plan no longer blocks it (#215).
 *
 * Mirrors prototype `renderCheckin()` (its numbers and choice of suggestion, not its HTML).
 */
export function weeklyCheckin(i: CheckinInput): WeeklyCheckin {
  const days = daysEnding(i.days, i.date, 21), wk = days.slice(-7), monday = mondayOf(i.date);
  const tt = wk.filter((d) => live(d.logs).length).map((d) => logTotals(d.logs, []));
  const avgK = tt.length ? tt.reduce((a, t) => a + t.kcal, 0) / tt.length : 0, avgP = tt.length ? tt.reduce((a, t) => a + t.protein_g, 0) / tt.length : 0;
  const sessions = wk.filter((d) => d.trained).length;
  const plannedN = i.weekPlan && i.weekPlan.start === monday ? i.weekPlan.list.length : planList(i.profile).length;
  const start = addDays(i.date, -6);
  const improved = Object.entries(i.lifts)
    .map(([n, L]) => {
      const h = L.hist ?? [], cur = h.filter((x) => x.date >= start), before = h.filter((x) => x.date < start);
      if (!cur.length || !before.length) return null;
      const a = Math.max(...before.map((x) => x.e)), b = Math.max(...cur.map((x) => x.e));
      return b > a * 1.01 ? { n, pct: Math.round((b / a - 1) * 100) } : null;
    })
    .filter((x): x is { n: string; pct: number } => x !== null)
    .sort((a, b) => b.pct - a.pct);
  const st = stalledList(i.lifts, i.date), burn = adaptiveBurn(days, i.weighIns, i.date, i.kcal, i.adaptive);
  const key = 'ci:' + monday;
  let suggestion: CheckinSuggestion | null = null;
  if (!i.dismissed?.[key] && !i.muted?.['checkin']) {
    const nt = burn.ready ? targetFromBurn(burn.burn, i.profile, i.weighIns, i.protein) : null;
    if (nt && Math.abs(nt.kcal - i.kcal) >= CHECKIN_KCAL_STEP) suggestion = { kind: 'kcal', target: nt };
    else if (plannedN > 4 && sessions + 2 <= plannedN && !(i.weekPlan && i.weekPlan.start >= monday)) suggestion = { kind: 'week' };
    else if (tt.length >= 3 && avgP < i.protein * 0.85) suggestion = { kind: 'protein' };
  }
  const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const w1 = weeklyAvg(i.weighIns, i.date), w0 = weeklyAvg(i.weighIns, addDays(i.date, -7));
  const sleep = avg(wk.map((d) => num(d.sleep)).filter((x) => x > 0));
  return {
    key,
    sessions,
    plannedN,
    logged: tt.length,
    avgK,
    avgP,
    pDays: tt.filter((t) => t.protein_g >= i.protein * 0.9).length,
    w1,
    w0,
    // Prototype `w1 && w0`: truthy, so a 0 average (not reachable through the entry limits) shows no change.
    weeklyChange: w1 && w0 ? { amount: Math.abs(w1 - w0), down: w1 <= w0 } : null,
    improved: improved.slice(0, 3),
    stalled: st.slice(0, 3),
    cardioMin: wk.reduce((a, d) => a + num(d.cardioMin), 0),
    steps: avg(wk.map((d) => num(d.steps)).filter((x) => x > 0)),
    sleep,
    sleepShort: sleep !== null && sleep < 7,
    burn,
    slopePerWeek: burn.ready ? burn.slope * 7 : null,
    formula: i.profile ? calcTargets(toTargetsProfile(i.profile)).tdee : null,
    suggestion,
  };
}

/** Result of `habits`. */
export interface Habits {
  /** Sessions a week to be on track: plan days − 1, at least 2. */
  goal: number;
  /** Consecutive on-track weeks before this one (up to 26). */
  weeks: number;
  /** Sessions this week so far. */
  thisWeek: number;
  /** Days with food logged in the 7 days ending on `date`. */
  logged: number;
  /** Which line shows: `streak` (2+ weeks), `missed` (food on fewer than 4 days), else `steady`. */
  message: 'streak' | 'missed' | 'steady';
}

/**
 * Gentle habits: on-track weeks in a row, not streaks of days.
 *
 * Mirrors prototype `consistencyHtml()` (its numbers and choice of line, not its HTML).
 */
export function habits(date: string, sessions: SessionLog, profile: PlanProfile | null | undefined, days: readonly ProgressDay[]): Habits {
  const goal = Math.max(2, splitFor(profile).list.length - 1), dates = Object.keys(sessions), monday = mondayOf(date);
  let weeks = 0;
  for (let k = 1; k <= 26; k++) {
    const ws = addDays(monday, -7 * k), we = addDays(ws, 7);
    if (dates.filter((d) => d >= ws && d < we).length >= goal) weeks++;
    else break;
  }
  const logged = daysEnding(days, date, 7).filter((d) => live(d.logs).length).length;
  const thisWeek = dates.filter((d) => d >= monday && d <= date).length;
  return { goal, weeks, thisWeek, logged, message: weeks >= 2 ? 'streak' : logged < 4 ? 'missed' : 'steady' };
}

/* ---------- weight and waist trend, scale-jump note, entry limits (#233) ---------- */

/** Prototype `r1`: to the nearest 0.1, as weigh-ins and tape measurements are saved and shown. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A dated value on a trend chart (kg or cm). */
export interface TrendPoint {
  date: string;
  v: number;
}

/** Weigh-ins on the weight chart (prototype `weightChart`'s `slice(-30)`). */
export const WEIGHT_CHART_POINTS = 30;
/** Measurements on the waist chart (prototype `measuresHtml`'s `slice(-20)`). */
export const WAIST_CHART_POINTS = 20;

const byDate = <T extends readonly [string, unknown]>(a: T, b: T): number => (a[0] < b[0] ? -1 : 1);

/**
 * The weight chart's points: the last 30 weigh-ins on or before `upTo`, oldest first. The chart, and
 * `trendChange`, need 2 or more; with fewer the prototype shows "Log a few weigh-ins to see your trend
 * line here."
 *
 * Mirrors the series in prototype `weightChart()`.
 */
export function weightSeries(weighIns: readonly WeighIn[], upTo: string): TrendPoint[] {
  return [...entries(weighIns)]
    .filter(([d]) => d <= upTo)
    .sort(byDate)
    .slice(-WEIGHT_CHART_POINTS)
    .map(([date, v]) => ({ date, v }));
}

/**
 * The waist chart's points: the last 20 days with a nonzero waist on or before `upTo`, oldest first.
 * The chart and the change line show only with 2 or more.
 *
 * Mirrors `waistPts` in prototype `measuresHtml()`.
 */
export function waistSeries(measurements: readonly MeasurementFacts[], upTo: string): TrendPoint[] {
  return live(measurements)
    .filter((m) => m.waist_cm && m.date <= upTo)
    .map((m) => [m.date, m.waist_cm as number] as const)
    .sort(byDate)
    .slice(-WAIST_CHART_POINTS)
    .map(([date, v]) => ({ date, v }));
}

/**
 * Result of `trendChange`: "Down 1.2 kg since 1 Oct." or "Waist up 0.5 cm since 1 Oct.", and at `none`
 * "No change since 1 Oct." or "No change in waist since 1 Oct." (#246).
 */
export interface TrendChange {
  /** Last point minus first, unrounded. */
  diff: number;
  /** `round1(|diff|)`, the number shown (not shown at `none`). */
  amount: number;
  /** `none` when `amount` is 0, else `down` when `diff < 0`, else `up`. */
  direction: 'down' | 'up' | 'none';
  /** Date of the first point, shown with `shortDate`. */
  since: string;
}

/**
 * Change from the first to the last point of a `weightSeries` or `waistSeries`, or null with fewer than 2.
 *
 * Mirrors `diff` in prototype `weightChart()` and `change` in `measuresHtml()`.
 */
export function trendChange(points: readonly TrendPoint[]): TrendChange | null {
  const first = points[0], last = points[points.length - 1];
  if (!first || !last || points.length < 2) return null;
  const diff = last.v - first.v, amount = round1(Math.abs(diff));
  return { diff, amount, direction: amount === 0 ? 'none' : diff < 0 ? 'down' : 'up', since: first.date };
}

/** Chart box in viewBox units: width, height, left and vertical padding. */
export interface ChartBox {
  W: number;
  H: number;
  px: number;
  py: number;
}

/** Prototype `weightChart`'s box. */
export const WEIGHT_CHART_BOX: ChartBox = { W: 320, H: 150, px: 34, py: 16 };
/** Prototype `lineChart`'s box (the waist chart). */
export const WAIST_CHART_BOX: ChartBox = { W: 320, H: 130, px: 34, py: 14 };

/** Result of `chartLayout`. */
export interface ChartLayout {
  /** Axis bounds, at least 1 apart (labelled with `round1`); grid lines at y = `py` and `H - py`. */
  min: number;
  max: number;
  /** Each point's position, unrounded (the prototype prints them with `toFixed(1)`). */
  points: { x: number; y: number }[];
}

/**
 * Line-chart layout: points spread evenly from `px` to `W - 8`, values scaled between `py` (max) and
 * `H - py` (min); a range under 1 is widened by 0.5 each way. Null with fewer than 2 points.
 *
 * Mirrors the geometry of prototype `weightChart()` (with `WEIGHT_CHART_BOX`) and `lineChart()` (`WAIST_CHART_BOX`).
 */
export function chartLayout(values: readonly number[], box: ChartBox): ChartLayout | null {
  if (values.length < 2) return null;
  const { W, H, px, py } = box;
  let mn = Math.min(...values), mx = Math.max(...values);
  if (mx - mn < 1) {
    mn -= 0.5;
    mx += 0.5;
  }
  const X = (i: number): number => px + (i * (W - px - 8)) / (values.length - 1), Y = (v: number): number => py + ((mx - v) * (H - py * 2)) / (mx - mn);
  return { min: mn, max: mx, points: values.map((v, i) => ({ x: X(i), y: Y(v) })) };
}

/** A rise at least this big over the last weigh-in triggers the scale-jump note, kg (prototype's 0.8). */
export const SCALE_JUMP_KG = 0.8;
/** How many days back the scale-jump note looks for the last weigh-in (prototype's 3). */
export const SCALE_JUMP_DAYS = 3;

/** The scale-jump note: "The scale went up `kg` kg". Shown only while the day shown is `date`. */
export interface ScaleJump {
  date: string;
  /** The rise, rounded to 0.1 kg. */
  kg: number;
}

/**
 * The scale-jump note on saving a weigh-in of `kg` (the saved value, `WeightEntry.kg`) on `date`: when
 * the rise over the latest weigh-in in the 3 days before, rounded to 0.1 kg, is 0.8 kg or more, so 80.8
 * after 80.0 (0.7999… in floating point) gives a note (#246). Null means no new note: as in the
 * prototype, an earlier note for the day stays until "Got it", even after a later save that is not a jump.
 *
 * Mirrors the `S.ui.scaleJump` step of the prototype's `case 'saveW'` (document click listener) and `scaleJumpHtml()`.
 */
export function scaleJump(weighIns: readonly WeighIn[], date: string, kg: number): ScaleJump | null {
  const from = addDays(date, -SCALE_JUMP_DAYS);
  const pv = [...entries(weighIns)]
    .filter(([d]) => d < date && d >= from)
    .sort(byDate)
    .pop();
  const rise = pv ? round1(kg - pv[1]) : 0;
  return rise >= SCALE_JUMP_KG ? { date, kg: rise } : null;
}

/** Weigh-ins must be above this, kg (contract `Weight.weight_kg` exclusiveMinimum; prototype `case 'saveW'`). */
export const WEIGHT_ABOVE_KG = 20;
/** Weigh-ins must be below this, kg (contract exclusiveMaximum; prototype `case 'saveW'`). */
export const WEIGHT_BELOW_KG = 400;
/** Tape measurements from this, cm (contract `TapeCm` minimum; prototype `saveMeasures`). */
export const TAPE_MIN_CM = 10;
/** Tape measurements up to this, cm (contract `TapeCm` maximum; prototype `saveMeasures`). */
export const TAPE_MAX_CM = 250;
/** Hours of sleep up to this (contract `DayNote.sleep` maximum; prototype `enSleep` input). */
export const SLEEP_MAX_H = 24;

/** What to do with the weight box: save `kg`, clear the day's weigh-in, or show "Enter your weight in kg, like 81.6". */
export type WeightEntry = { kind: 'save'; kg: number } | { kind: 'clear' } | { kind: 'bad' };

/**
 * Reads the weight box: the value rounded to 0.1 saves when it is above 20 and below 400 kg, the
 * contract's exclusive bounds, so 20.01–20.04 and 399.95–399.99 (which round to 20.0 and 400.0) are
 * bad (#247); a blank box clears; anything else is bad.
 *
 * Mirrors the checks in the prototype's `case 'saveW'` (document click listener).
 */
export function weightEntry(text: string): WeightEntry {
  const kg = round1(num(text));
  if (kg > WEIGHT_ABOVE_KG && kg < WEIGHT_BELOW_KG) return { kind: 'save', kg };
  if (!text.trim()) return { kind: 'clear' };
  return { kind: 'bad' };
}

/**
 * The tape boxes to save: each from 10 to 250 cm, rounded to 0.1; blank or out-of-range boxes are left
 * out. An empty result means "Enter at least one measurement in cm." and nothing is saved; otherwise
 * the row is merged over the day's stored measurement.
 *
 * Mirrors prototype `saveMeasures()`.
 */
export function measurementRow(entered: Readonly<Partial<Record<MeasureKey, string>>>): Partial<Record<MeasureKey, number>> {
  const row: Partial<Record<MeasureKey, number>> = {};
  for (const [k, text] of Object.entries(entered) as [MeasureKey, string | undefined][]) {
    const v = num(text);
    if (v >= TAPE_MIN_CM && v <= TAPE_MAX_CM) row[k] = round1(v);
  }
  return row;
}

/** What to do with the sleep box: save `h`, clear it, or reject it. */
export type SleepEntry = { kind: 'save'; h: number } | { kind: 'clear' } | { kind: 'bad' };

/**
 * Reads the hours-slept box: blank clears; otherwise the parsed hours (comma decimals accepted, not
 * rounded), bad when below 0 or above 24 (the contract's `DayNote.sleep` bounds), or when the text is not
 * a number, so a typo is not saved as a 0-hour night (#247). Text that starts with a number reads as
 * `parseFloat` does: "7 h" is 7. On bad the prototype keeps the stored value.
 *
 * Mirrors the `enSleep` step of the prototype's document input listener.
 */
export function sleepEntry(text: string): SleepEntry {
  if (!text.trim()) return { kind: 'clear' };
  if (!Number.isFinite(parseFloat(text.replace(',', '.')))) return { kind: 'bad' };
  const h = num(text);
  return h >= 0 && h <= SLEEP_MAX_H ? { kind: 'save', h } : { kind: 'bad' };
}
