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

export const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function exerciseRecord(e: ExState): WorkoutExercise {
  return { name: e.name, part: e.part, bridge: e.bridge, form: e.form, found_kg: e.found, skip_ramp: e.skipRamp, ...(e.feel ? { feel: e.feel } : {}) };
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
