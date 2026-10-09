import { cantRule, widerRuleReplacements, type CantDraft, type CantRule, type Exclusion } from './exclusions';
import type { Where } from './plan';
import { lastFor, type LiftRecord } from './progression';
import type { ExerciseCatalog } from './session';

/** An exercise in a workout (contract `WorkoutExercise`). */
export interface CantExercise {
  name: string;
  part: 1 | 2;
  bridge: boolean;
  form: 'yes' | 'no' | null;
  found_kg: number | null;
  skip_ramp: boolean;
}

/**
 * The fields of a contract `WorkoutSet` that `replaceAt` reads. Other fields (id, sync fields, weight,
 * reps, rate, `t`) are kept as they are. Sets with `deleted_at` set are tombstones: left as they are.
 */
export interface CantSet {
  exercise: string;
  kind: 'work' | 'ramp';
  set_index: number;
  done: boolean;
  deleted_at?: string | null;
}

/** A blank work set for a newly added exercise (contract `WorkoutSet` fields; the caller adds id, sync fields and `workout_id`). */
export interface NewCantSet {
  exercise: string;
  kind: 'work';
  set_index: number;
  weight_kg: null;
  reps: null;
  done: false;
  rate: null;
  t: null;
}

/** A workout after `replaceAt` or `cantSession`. */
export interface CantResult<E extends CantExercise, S extends CantSet> {
  /** The workout's exercises, in order (contract `Workout.exercises`). */
  exercises: (E | CantExercise)[];
  /**
   * Every set of the workout: kept sets (a kept work set may have a new `set_index`; it is a copy
   * then), in the input order, followed by the new blank sets (`NewCantSet`, no id yet).
   */
  sets: (S | NewCantSet)[];
  /** Input sets taken out of the workout: store them as tombstones. */
  removed: S[];
}

/** What `replaceAt` and `cantSession` read for the pick's set count: prototype `S.lifts` and `S.date`. */
export interface CantLifts {
  lifts: Readonly<Record<string, LiftRecord>>;
  /** Today, `YYYY-MM-DD`. */
  date: string;
}

const live = (s: CantSet): boolean => !s.deleted_at;

/**
 * The pick as a new exercise: part 1, no bridge, no form answer, no ramp result, and as many blank
 * work sets as the last session before today had, at least 3 (3 with no history). The prototype's new
 * exercise has no `part`; it reads as part 1, even in place of a part-2 exercise (#267).
 *
 * Mirrors prototype `newExercise(name)` (`lastFor` with `S.lifts` and `S.date` passed in).
 */
function newExercise(name: string, c: CantLifts): { ex: CantExercise; sets: NewCantSet[] } {
  const last = lastFor(name, c.lifts, c.date);
  const n = last ? Math.max(3, last.sets.length) : 3;
  return {
    ex: { name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false },
    sets: Array.from({ length: n }, (_, i) => ({ exercise: name, kind: 'work', set_index: i, weight_kg: null, reps: null, done: false, rate: null, t: null })),
  };
}

/**
 * Replaces the exercise at `idx` with `pick` (null: no replacement). When it has ticked work sets, it
 * stays with only those (renumbered from 0 in their order; ramp sets and its other fields kept) and the
 * pick, if any, goes right after it. Otherwise it goes with all its sets (ramp sets too, ticked or not),
 * and the pick, if any, takes its place. Ticked ramp sets alone do not keep an exercise.
 *
 * Mirrors the `replaceAt(idx, pick)` step of prototype `applyCant(choice)` (`w.exercises` as contract
 * `Workout.exercises` and `WorkoutSet`s).
 */
export function replaceAt<E extends CantExercise, S extends CantSet>(exercises: readonly E[], sets: readonly S[], idx: number, pick: string | null, c: CantLifts): CantResult<E, S> {
  const ex = exercises[idx];
  if (!ex) return { exercises: [...exercises], sets: [...sets], removed: [] };
  const mine = (s: S): boolean => live(s) && s.exercise === ex.name;
  const work = sets.filter((s) => mine(s) && s.kind === 'work').sort((a, b) => a.set_index - b.set_index);
  const done = work.filter((s) => s.done);
  const nx = pick ? newExercise(pick, c) : null;
  const out: (E | CantExercise)[] = [...exercises];
  if (done.length) {
    if (nx) out.splice(idx + 1, 0, nx.ex);
    const index = new Map(done.map((s, i) => [s, i]));
    const kept: S[] = [];
    const removed: S[] = [];
    for (const s of sets) {
      if (!mine(s) || s.kind !== 'work') kept.push(s);
      else if (s.done) kept.push(s.set_index === index.get(s) ? s : { ...s, set_index: index.get(s) as number });
      else removed.push(s);
    }
    return { exercises: out, sets: [...kept, ...(nx ? nx.sets : [])], removed };
  }
  if (nx) out.splice(idx, 1, nx.ex);
  else out.splice(idx, 1);
  return { exercises: out, sets: [...sets.filter((s) => !mine(s)), ...(nx ? nx.sets : [])], removed: sets.filter(mine) };
}

/**
 * Today's workout after a "can't do" answer. The rule is `cantRule(draft, choice, c.date)`. The tapped
 * exercise (index `i`, null when the sheet was opened from elsewhere) is replaced by `choice` with
 * `replaceAt`, only if it is still at `i`. Then, unless the answer is for today only, every other
 * exercise the new rule covers is replaced as `widerRuleReplacements` says (with the rule added to
 * `exclusions`). `exclusions` are the saved rules before this answer; save the rule as `cantRule` says.
 *
 * Mirrors the workout steps of prototype `applyCant(choice)`.
 */
export function cantSession<E extends CantExercise, S extends CantSet>(
  exercises: readonly E[],
  sets: readonly S[],
  i: number | null,
  draft: CantDraft,
  choice: string | null,
  where: Where,
  exclusions: readonly Exclusion[],
  c: CantLifts,
  catalog: Pick<ExerciseCatalog, 'tags'>,
): CantResult<E, S> {
  const rule: CantRule = cantRule(draft, choice, c.date);
  const today = draft.dur === 'today';
  let w: CantResult<E, S> = { exercises: [...exercises], sets: [...sets], removed: [] };
  const step = (idx: number, pick: string | null): void => {
    const next = replaceAt<E | CantExercise, S | NewCantSet>(w.exercises, w.sets, idx, pick, c);
    const inputs = new Set<unknown>(sets);
    w = { exercises: next.exercises, sets: next.sets, removed: [...w.removed, ...(next.removed.filter((s) => inputs.has(s)) as S[])] };
  };
  if (i !== null && w.exercises[i] && (w.exercises[i] as CantExercise).name === draft.name) step(i, choice);
  if (!today) {
    const shown = w.exercises.map((e) => ({ name: e.name, sets: w.sets.filter((s) => live(s) && s.exercise === e.name && s.kind === 'work') }));
    for (const r of widerRuleReplacements(shown, rule, choice, where, [...exclusions, rule], c.lifts, catalog)) step(r.index, r.to);
  }
  return w;
}
