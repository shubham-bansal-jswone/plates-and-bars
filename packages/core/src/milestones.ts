import { addDays, mondayOf } from './dates';
import { bodyweightOn, habits, type WeighIn } from './progress';
import { sessionDates, type PlanProfile, type SessionLog } from './plan';
import type { ExType } from './progression';
import type { PrSet } from './records';
import { formatWeight, unitLabel, type WeightUnit } from './weightUnit';

/**
 * Milestones (#1351 C6). A new rule set, not prototype ports (the prototype has no milestones). Earned
 * only, derived from stored data on every call: nothing is stored, so a milestone is never revoked while
 * its source data exists and goes away on recompute if that data (a set, a session) is deleted. No points,
 * levels, streaks or locked entries; badges are a separate v3 issue (#1356).
 *
 * "New best estimated 1RM" is deliberately NOT a milestone: that is the Recent PRs list
 * (`personalRecords`, records.ts), and a second place for it would disagree with the list.
 *
 * Weights are kg in storage; `unit` only picks the wording. Every threshold is unit-independent, so switching
 * kg and lb never moves or removes a milestone (plates are earned by the kg steps only; every lb step is heavier than its kg step, so an lb clause would never change a result).
 *
 * For the app (A9): decide "newly earned" from a stored set of the ids already shown, not from `date === today`.
 * A date check would never toast the plan block, which is dated the Sunday before `habits` first reports it.
 */

/**
 * Plate steps in kg: 1, 2 and 3 plates a side on a 20 kg bar with 20 kg plates. Used for every unit. An lb user
 * earns "One plate a side" at 132.3 lb (60 kg of 20 kg plates), so the wording must not imply 45 lb plates.
 */
export const PLATE_MILESTONES: readonly [number, number, number] = [60, 100, 140];

/** Float epsilon (kg) for kg comparisons: 59.9 kg is not a plate and 79.9 kg is not an 80 kg bodyweight. */
export const KG_EPSILON = 1e-6;

/** Barbell-typed library lifts that use an EZ bar (about 10 kg, not 20 kg), so "plates a side" does not apply (a test checks they exist in the content). */
export const EZ_BAR_LIFTS: readonly string[] = ['Preacher Curl'];

/** Library names counted as a bench press for the bodyweight milestone (loaded barbell lifts only; a test checks they are in the content). */
export const BENCH_LIFTS: readonly string[] = ['Barbell Bench Press'];
/** Library names counted as a squat for the 1.5 x bodyweight milestone. */
export const SQUAT_LIFTS: readonly string[] = ['Barbell Back Squat'];
/** Bodyweight multiples for bench and squat. */
export const BENCH_BODYWEIGHT_X = 1;
export const SQUAT_BODYWEIGHT_X = 1.5;

/** Completed-workout counts that earn a milestone. */
export const WORKOUT_MILESTONES: readonly number[] = [10, 50, 100];
/** Consecutive on-track weeks (as `habits`) for the plan milestone. */
export const PLAN_BLOCK_WEEKS = 4;

export type MilestoneKind = 'plates' | 'bodyweight' | 'workouts' | 'plan';

/** One earned milestone. `id` is stable (the app toasts each id once). */
export interface Milestone {
  /** `plates-1|2|3`, `bench-bodyweight`, `squat-1.5x-bodyweight`, `workouts-10|50|100`, `plan-block-4w`. */
  id: string;
  kind: MilestoneKind;
  title: string;
  detail: string;
  /** `YYYY-MM-DD` the milestone was first earned. */
  date: string;
}

/** The profile fields milestones read: the plan (as `habits`) and the weight used before any weigh-in. */
export interface MilestoneProfile extends PlanProfile {
  /** Contract `Profile.weight_kg`. */
  weight_kg?: number | null | undefined;
}

/** A set that counts: done work set, not deleted, not rated fail, with a weight and at least one rep. */
function counts(s: PrSet): s is PrSet & { weight_kg: number } {
  return !s.deleted_at && s.kind === 'work' && s.done && s.rate !== 'fail' && (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) >= 1;
}

interface Hit {
  date: string;
  lift: string;
  w: number;
}

/** The earliest qualifying set; on that day the lightest (`light`, the one that crossed a plate step) or the heaviest, then by name; or null. */
function earliest(hits: Hit[], light: boolean): Hit | null {
  let best: Hit | null = null;
  for (const h of hits) {
    const dw = light ? best ? h.w - best.w : 0 : best ? best.w - h.w : 0;
    if (!best || h.date < best.date || (h.date === best.date && (dw < 0 || (dw === 0 && h.lift < best.lift)))) best = h;
  }
  return best;
}

const WORDS = ['', 'One', 'Two', 'Three'];
const ord = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const show = (kg: number, unit: WeightUnit): string => `${formatWeight(kg, unit)} ${unitLabel(unit)}`;

/**
 * The earned milestones, each with the date it was first earned, newest first (same date: by `id`).
 * Only data dated on or before `end` (the viewed date) counts. `sets` are stored sets (`PrSet`; deleted
 * and fail-rated sets, ramp sets and undone sets are ignored); `sessions` is the session log; `weights`
 * the weigh-ins; `types` maps lift name to type as for `personalRecords` (built through `exInfo`, overrides
 * included; a lift missing from it is NOT a barbell). `profile` is optional: its `weight_kg` is the
 * bodyweight before any weigh-in, and its plan sets the on-track goal (`habits`; absent reads as the
 * 6-day plan, `days: 0` has no plan and never earns the plan block).
 *
 * 1. Plates: first done work set of a barbell lift (not an `EZ_BAR_LIFTS` one) at 1, 2 or 3 plates a side:
 *    at least the kg step (60, 100, 140; float epsilon only), whatever the `unit`, which only changes the
 *    wording. The detail shows the lightest set of that day that meets it. A9: the wording must not imply 45 lb
 *    plates; an lb user earns "One plate a side" at 132.3 lb (20 kg plates).
 * 2. Bench at bodyweight / 3. squat at 1.5 x bodyweight: first such set of a `BENCH_LIFTS` / `SQUAT_LIFTS`
 *    lift at or above the bodyweight of that day (heaviest set of the day shown) (latest weigh-in on or before it, else the profile weight;
 *    none known, no milestone).
 * 4. Workouts: the 10th, 50th and 100th day with at least one logged set (`sessionDates`, the rule that
 *    orders the plan); dated on that day.
 * 5. First 4 consecutive on-track weeks by `habits` (reused: `weeks` as seen from each Monday); dated on
 *    the Sunday that ends the block, the day before `habits` first reports it.
 * New best estimated 1RM is not a milestone (see the note at the top).
 *
 * New rule (#1351).
 */
export function milestones(
  sets: readonly PrSet[],
  sessions: SessionLog,
  weights: readonly WeighIn[],
  types: Readonly<Record<string, ExType>>,
  unit: WeightUnit,
  end: string,
  profile?: MilestoneProfile | null,
): Milestone[] {
  const out: Milestone[] = [];
  const live = sets.filter((s) => s.date <= end && counts(s));

  // 1. Plates
  const barbell = live.filter((s) => types[s.exercise] === 'barbell' && !EZ_BAR_LIFTS.includes(s.exercise));
  PLATE_MILESTONES.forEach((kgStep, i) => {
    const hit = earliest(barbell.filter((s) => (s.weight_kg as number) >= kgStep - KG_EPSILON).map((s) => ({ date: s.date, lift: s.exercise, w: s.weight_kg as number })), true);
    if (!hit) return;
    const n = i + 1;
    out.push({ id: `plates-${n}`, kind: 'plates', title: `${WORDS[n]} ${n === 1 ? 'plate' : 'plates'} a side`, detail: `${hit.lift}, ${show(hit.w, unit)}`, date: hit.date });
  });

  // 2 and 3. Bodyweight multiples, against the bodyweight of the day of the set.
  const times = (names: readonly string[], x: number): Hit | null =>
    earliest(
      live
        .filter((s) => names.includes(s.exercise))
        .filter((s) => {
          const bw = bodyweightOn(weights, s.date, profile?.weight_kg);
          return bw !== null && (s.weight_kg as number) >= bw * x - KG_EPSILON;
        })
        .map((s) => ({ date: s.date, lift: s.exercise, w: s.weight_kg as number })),
      false,
    );
  const bench = times(BENCH_LIFTS, BENCH_BODYWEIGHT_X);
  if (bench) out.push({ id: 'bench-bodyweight', kind: 'bodyweight', title: 'Bench press at your bodyweight', detail: `${bench.lift}, ${show(bench.w, unit)}`, date: bench.date });
  const squat = times(SQUAT_LIFTS, SQUAT_BODYWEIGHT_X);
  if (squat) out.push({ id: 'squat-1.5x-bodyweight', kind: 'bodyweight', title: 'Squat at 1.5 times your bodyweight', detail: `${squat.lift}, ${show(squat.w, unit)}`, date: squat.date });

  // 4. Workout counts
  const days = sessionDates(sessions, addDays(end, 1));
  for (const n of WORKOUT_MILESTONES) {
    const date = days[n - 1];
    if (date !== undefined) out.push({ id: `workouts-${n}`, kind: 'workouts', title: `${ord(n)} workout`, detail: `${n} workouts completed`, date });
  }

  // 5. First 4-week block on plan, scanning Mondays with `habits`.
  const first = Object.keys(sessions).filter((d) => d <= end).sort()[0];
  if (first !== undefined && profile?.days !== 0) {
    const last = mondayOf(end);
    for (let m = addDays(mondayOf(first), 7 * PLAN_BLOCK_WEEKS); m <= last; m = addDays(m, 7)) {
      if (habits(m, sessions, profile, []).weeks >= PLAN_BLOCK_WEEKS) {
        out.push({ id: 'plan-block-4w', kind: 'plan', title: 'Four weeks on plan', detail: `${PLAN_BLOCK_WEEKS} weeks in a row on track`, date: addDays(m, -1) });
        break;
      }
    }
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
