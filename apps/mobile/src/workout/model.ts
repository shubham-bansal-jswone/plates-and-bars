import { num, type Rate, type SetEntry } from '@plate-and-bar/core';
import { newId } from '../db/records';
import type { Form, Workout, WorkoutExercise, WorkoutSet } from './types';

/** A set row as the screen edits it: weight and reps are the typed text. */
export interface Row extends SetEntry {
  id: string;
  version: number;
  rate: Rate | null;
  t: string | null;
}

/** An exercise in today's session with its working sets and find-your-weight ramp sets. */
export interface ExState {
  name: string;
  part: 1 | 2;
  bridge: boolean;
  form: Form;
  found: number | null;
  skipRamp: boolean;
  /** The answer to "Where did you feel that set most?" ('target', 'pain' or a `misplaced_feel` index). */
  feel: string | null;
  sets: Row[];
  ramp: Row[];
}

export const blankRow = (): Row => ({ id: newId(), version: 0, w: '', r: '', done: false, rate: null, t: null });

/**
 * A day with cardio minutes but no session: a workout row with no template, no base and no exercises (the contract allows
 * all three; the prototype's blank `day.workout` is the same). Starting a session fills it in and keeps the minutes.
 */
export const isCardioOnly = (w: Workout): boolean => w.template === null && w.base === null && w.exercises.length === 0;

export const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The stored exercise for `e`. Keys this client does not know (added by a newer one) are carried through from the
 * `stored` copy, as `mods` is; the known keys always come from the screen, and `feel` is dropped when it is cleared.
 */
export function exerciseRecord(e: ExState, stored?: WorkoutExercise): WorkoutExercise {
  const { feel: _f, ...extra } = stored ?? ({} as WorkoutExercise);
  return { ...extra, name: e.name, part: e.part, bridge: e.bridge, form: e.form, found_kg: e.found, skip_ramp: e.skipRamp, ...(e.feel ? { feel: e.feel } : {}) };
}

const text = (n: number | null): string => (n === null ? '' : String(n));

/** The stored row for one set. Blank fields are null; typed text becomes a number. */
export function setRecord(e: ExState, kind: 'work' | 'ramp', index: number, now: Date): WorkoutSet {
  const row = (kind === 'work' ? e.sets : e.ramp)[index] as Row;
  return {
    id: row.id,
    version: row.version,
    updated_at: stamp(now),
    deleted_at: null,
    workout_id: null,
    exercise: e.name,
    kind,
    set_index: index,
    // The contract's minimum is 0 for both, so a typed negative is stored as 0.
    weight_kg: row.w === '' ? null : Math.max(0, num(row.w)),
    reps: row.r === '' ? null : Math.max(0, Math.round(num(row.r))),
    done: row.done,
    rate: row.rate,
    t: row.t,
  };
}

/** Rebuilds the screen's exercises from the stored workout and its sets. */
export function exercisesFrom(w: Workout, sets: readonly WorkoutSet[]): ExState[] {
  const rows = (name: string, kind: 'work' | 'ramp'): Row[] =>
    sets
      .filter((s) => s.exercise === name && s.kind === kind && !s.deleted_at)
      .sort((a, b) => a.set_index - b.set_index)
      .map((s) => ({ id: s.id, version: s.version, w: text(s.weight_kg), r: text(s.reps), done: s.done, rate: s.rate, t: s.t }));
  return w.exercises.map((x) => ({
    name: x.name,
    part: x.part,
    bridge: x.bridge,
    form: x.form,
    found: x.found_kg,
    skipRamp: x.skip_ramp,
    feel: x.feel ?? null,
    sets: rows(x.name, 'work'),
    ramp: rows(x.name, 'ramp'),
  }));
}

const touched = (r: Row): boolean => r.done || r.w !== '' || r.r !== '' || r.rate !== null;

/**
 * Start dropped the local build for a session another device stored (#898). What was typed or ticked on the dropped build is
 * carried onto the adopted session where it has the same exercise name and set position, and only onto a set nobody has touched
 * there; anything else is dropped, so the adopted session is never overwritten and no set rows are left without an exercise.
 * Only the working sets are carried: ramp rows and exercise-level fields (form, feel, found, skip ramp) of the dropped build are
 * intentionally not, the adopted session wins. Returns the adopted list with the carried values (the adopted set ids and
 * versions are kept), the sets that changed, and for every touched local set the adopted id it landed on (null when dropped).
 */
export function carryOnto(adopted: readonly ExState[], local: readonly ExState[]): { exs: ExState[]; changed: { name: string; ids: string[] }[]; kept: Map<string, string | null> } {
  const changed: { name: string; ids: string[] }[] = [];
  const kept = new Map<string, string | null>();
  const exs = structuredClone(adopted) as ExState[];
  for (const mine of local) for (const m of mine.sets) if (touched(m)) kept.set(m.id, null);
  for (const ex of exs) {
    const mine = local.find((l) => l.name === ex.name);
    if (!mine) continue;
    const ids: string[] = [];
    mine.sets.forEach((m, j) => {
      const row = ex.sets[j];
      if (!row || !touched(m) || touched(row)) return;
      Object.assign(row, { w: m.w, r: m.r, done: m.done, rate: m.rate, t: m.t });
      ids.push(row.id);
      kept.set(m.id, row.id);
    });
    if (ids.length) changed.push({ name: ex.name, ids });
  }
  return { exs, changed, kept };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Each field: this device's value where it changed it since `base`, else the stored one. */
function pick<T extends object>(base: T | undefined, mine: T, theirs: T): T {
  const out = { ...theirs };
  for (const k of Object.keys(mine) as (keyof T)[]) if (!base || !same(mine[k], base[k])) out[k] = mine[k];
  return out;
}

/**
 * Today's workout row when the stored copy changed since this screen last loaded or wrote it (`base`): a sync pull or a
 * rule saved on Targets. A three-way merge by field and by exercise name: the stored list and order are kept, edits made
 * here win field by field, exercises added here are appended, and exercises removed on either side stay removed (#410).
 */
export function mergeWorkout(base: Workout, mine: Workout, theirs: Workout): Workout {
  const byName = (l: readonly WorkoutExercise[]) => new Map(l.map((e) => [e.name, e]));
  const b = byName(base.exercises), m = byName(mine.exercises), t = byName(theirs.exercises);
  const exercises = [
    ...theirs.exercises.flatMap((e) => {
      const own = m.get(e.name);
      if (own) return [pick(b.get(e.name), own, e)];
      return b.has(e.name) ? [] : [e]; // in the base but not here: removed on this device, so it stays removed
    }),
    ...mine.exercises.filter((e) => !t.has(e.name) && !b.has(e.name)),
  ];
  const { exercises: _b, ...baseRest } = base;
  const { exercises: _m, ...mineRest } = mine;
  const { exercises: _t, ...theirsRest } = theirs;
  return { ...pick(baseRest, mineRest, theirsRest), exercises };
}

/** A workout row as text without its `version`: a sync push patches only the version, so it does not count as a change. */
export const unversioned = ({ version: _v, ...w }: Workout): string => JSON.stringify(w);

const hasSession = (w: Workout): boolean => !isCardioOnly(w);
const later = (a: Workout, b: Workout): boolean => Date.parse(a.updated_at) > Date.parse(b.updated_at);

/**
 * One workout row from two copies of the same day that no three-way merge can relate: this device's unpushed `mine` and the
 * server's `theirs`, edited on two devices that had not seen each other (#647; the caller checks that this row never saw a server copy, since without a base a removal cannot be told from an addition). The contract settles such a push whole-record
 * by `updated_at`; this keeps what the loser added. The later row (a tie goes to `theirs`, as on the server) supplies the
 * fields; a session on only one side is kept even when the other row is later (a cardio-only day has none), and the cardio
 * minutes survive from either side. Two sessions are not combined: the later one stands. The result carries `theirs.version`,
 * so pushing it is not a conflict.
 */
export function unionWorkout(mine: Workout, theirs: Workout): Workout {
  const win = later(mine, theirs) ? mine : theirs;
  const lose = win === mine ? theirs : mine;
  const base = hasSession(win) || !hasSession(lose) ? win : lose;
  return {
    ...base,
    cardio_min: win.cardio_min ?? lose.cardio_min,
    id: theirs.id,
    version: theirs.version,
    updated_at: win.updated_at,
  };
}
