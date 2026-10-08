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
  sets: Row[];
  ramp: Row[];
}

export const blankRow = (): Row => ({ id: newId(), version: 0, w: '', r: '', done: false, rate: null, t: null });

export const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function exerciseRecord(e: ExState): WorkoutExercise {
  return { name: e.name, part: e.part, bridge: e.bridge, form: e.form, found_kg: e.found, skip_ramp: e.skipRamp };
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
    weight_kg: row.w === '' ? null : num(row.w),
    reps: row.r === '' ? null : Math.round(num(row.r)),
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
    sets: rows(x.name, 'work'),
    ramp: rows(x.name, 'ramp'),
  }));
}
