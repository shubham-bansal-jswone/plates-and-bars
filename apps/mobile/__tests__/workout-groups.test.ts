import { cantChange, keepGroups } from '../src/workout/cantApply';
import { carryOnto, exerciseRecord, exercisesFrom, mergeWorkout, unionWorkout, type ExState } from '../src/workout/model';
import type { Workout, WorkoutExercise, WorkoutSet } from '../src/workout/types';

const ex = (name: string, o: Partial<WorkoutExercise> = {}): WorkoutExercise => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...o });
const g = (name: string, group: string | null | undefined) => ex(name, group === undefined ? {} : { group });
const row = (exercises: WorkoutExercise[], o: Partial<Workout> = {}): Workout => ({
  id: null, version: 2, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date: '2026-10-08', template: 'Upper A', base: 'Upper A', where: null, cardio_min: null,
  mods: { deload: false, light: false, reentry: 0, short: false, where: 'gym' }, exercises, ci_choice: null, ...o,
});
const state = (name: string, group?: string | null): ExState => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, ...(group === undefined ? {} : { group }), sets: [], ramp: [] });
const names = (w: Workout) => w.exercises.map((e) => [e.name, e.group ?? null]);

describe('group on the exercise record (#1182)', () => {
  it('round trips a set group', () => {
    const rec = exerciseRecord(state('Bench', 'g1'));
    expect(rec.group).toBe('g1');
    expect(exercisesFrom(row([rec, g('Row', 'g1')]), [])[0]?.group).toBe('g1');
  });
  it('a cleared group is written as an explicit null', () => {
    const out = exerciseRecord(state('Bench', null), g('Bench', 'g1'));
    expect('group' in out && out.group === null).toBe(true);
  });
  it('an exercise that never had a group gets no key; the record is byte-identical to before', () => {
    const stored = ex('Bench');
    expect(JSON.stringify(exerciseRecord(state('Bench'), stored))).toBe(JSON.stringify(exerciseRecord(state('Bench'))));
    expect('group' in exerciseRecord(state('Bench', null), stored)).toBe(false);
    expect('group' in exerciseRecord(state('Bench', null))).toBe(false);
  });
  it('a stored null stays an explicit null', () => {
    expect(exerciseRecord(state('Bench', null), g('Bench', null))).toHaveProperty('group', null);
  });
  it('an invalid stored group reads as ungrouped and is rewritten as null', () => {
    for (const bad of [5, 'has space', '']) {
      const stored = { ...ex('A'), group: bad } as unknown as WorkoutExercise;
      const [a] = exercisesFrom(row([stored, g('B', 'x')]), []);
      expect(a?.group).toBeNull();
      expect(exerciseRecord(a as ExState, stored)).toHaveProperty('group', null);
    }
  });
  it('a group of one reads as ungrouped', () => {
    expect(exercisesFrom(row([g('A', 'x'), g('B', null)]), []).map((e) => e.group)).toEqual([null, null]);
  });
  it('other unknown keys are still carried', () => {
    const stored = { ...ex('A'), future: 1 } as WorkoutExercise;
    expect(exerciseRecord(state('A', 'g'), stored)).toMatchObject({ future: 1, group: 'g' });
  });
});

describe('group in the three-way merge', () => {
  const base = row([g('A', 'g1'), g('B', 'g1'), g('C', undefined)]);
  it('ungrouped here while the other device is unchanged: ungrouped after the merge', () => {
    const mine = row([g('A', null), g('B', null), g('C', undefined)]);
    expect(names(mergeWorkout(base, mine, base))).toEqual([['A', null], ['B', null], ['C', null]]);
  });
  it('the other device regroups while this one adds an exercise: a valid group', () => {
    const theirs = row([g('A', 'g2'), g('B', 'g2'), g('C', undefined)]);
    const mine = row([g('A', 'g1'), g('B', 'g1'), g('C', undefined), g('D', undefined)]);
    expect(names(mergeWorkout(base, mine, theirs))).toEqual([['A', 'g2'], ['B', 'g2'], ['C', null], ['D', null]]);
  });
  it('a group split by the merge is dissolved with explicit nulls', () => {
    const b = row([g('A', undefined), g('B', undefined)]);
    const theirs = row([g('A', 'x'), g('B', undefined), g('E', 'x')]);
    const out = mergeWorkout(b, b, theirs);
    expect(out.exercises.map((e) => e.group)).toEqual([null, undefined, null]);
  });
  it('both devices create different groups', () => {
    const b = row([g('A', undefined), g('B', undefined), g('C', undefined), g('D', undefined)]);
    const theirs = row([g('A', 'x'), g('B', 'x'), g('C', undefined), g('D', undefined)]);
    const mine = row([g('A', undefined), g('B', undefined), g('C', 'y'), g('D', 'y')]);
    expect(names(mergeWorkout(b, mine, theirs))).toEqual([['A', 'x'], ['B', 'x'], ['C', 'y'], ['D', 'y']]);
  });
  it('an explicit null here wins over the server value', () => {
    const theirs = row([g('A', 'g1'), g('B', 'g1'), g('C', undefined)], { version: 3 });
    const mine = row([g('A', null), g('B', null), g('C', undefined)]);
    expect(mergeWorkout(base, mine, theirs).exercises.map((e) => e.group)).toEqual([null, null, undefined]);
  });
  it('more than 6 members: the extras are ungrouped', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => g(n, 'x'));
    const out = unionWorkout(row(many), row([], { template: null, base: null }));
    expect(out.exercises.map((e) => e.group)).toEqual(['x', 'x', 'x', 'x', 'x', 'x', null]);
  });
  it('a group id survives the export and restore path', () => {
    const list = [state('A', 'g1'), state('B', 'g1')].map((e) => exerciseRecord(e));
    expect(exercisesFrom(row(JSON.parse(JSON.stringify(list))), []).map((e) => e.group)).toEqual(['g1', 'g1']);
  });
});

describe('carryOnto keeps groups valid', () => {
  it('dissolves a broken group on the adopted list', () => {
    const adopted = [state('A', 'x'), state('B', null)];
    expect(carryOnto(adopted, []).exs.map((e) => e.group)).toEqual([null, null]);
  });
  it('keeps a valid one', () => {
    expect(carryOnto([state('A', 'x'), state('B', 'x')], []).exs.map((e) => e.group)).toEqual(['x', 'x']);
  });
});

describe('can\'t-do swap keeps the group', () => {
  it('the replacement takes the group of the exercise it replaced', () => {
    const w = row([g('Barbell Bench Press', 'x'), g('Barbell Row', 'x'), g('Barbell Curl', undefined)]);
    const ch = cantChange(w, [], 0, { name: 'Barbell Bench Press', reason: 'dislike', dur: 'today' }, 'Dumbbell Bench Press', 'gym', [], {}, '2026-10-08', '2026-10-08T08:00:00Z');
    expect(ch.exercises.map((e) => [e.name, e.group ?? null])).toEqual([['Dumbbell Bench Press', 'x'], ['Barbell Row', 'x'], ['Barbell Curl', null]]);
  });
  const set = (exercise: string, o: Partial<WorkoutSet> = {}): WorkoutSet => ({
    id: `${exercise}-${o.set_index ?? 0}`, version: 1, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, workout_id: null,
    exercise, kind: 'work', set_index: 0, weight_kg: 60, reps: 8, done: false, rate: null, t: null, ...o,
  });
  const swap = (w: Workout, sets: WorkoutSet[], name: string, choice: string | null, dur: 'today' | 'perm' = 'today') =>
    cantChange(w, sets, w.exercises.findIndex((e) => e.name === name), { name, reason: 'dislike', dur }, choice, 'gym', [], {}, '2026-10-08', '2026-10-08T08:00:00Z');
  const groups = (c: { exercises: WorkoutExercise[] }) => c.exercises.map((e) => [e.name, e.group ?? null]);

  it('a swap of an exercise with ticked sets keeps it and the replacement joins its group (right after it)', () => {
    const w = row([g('Barbell Bench Press', 'x'), g('Barbell Row', 'x'), g('Barbell Curl', undefined)]);
    const out = swap(w, [set('Barbell Bench Press', { done: true })], 'Barbell Bench Press', 'Dumbbell Bench Press');
    expect(groups(out)).toEqual([['Barbell Bench Press', 'x'], ['Dumbbell Bench Press', 'x'], ['Barbell Row', 'x'], ['Barbell Curl', null]]);
  });
  it('two replacements for two removed exercises are paired in order', () => {
    const before = [ex('Barbell Bench Press', { group: 'x' }), ex('Barbell Row', { group: 'y' }), ex('Barbell Curl', { group: 'y' })];
    const out = keepGroups(before, [ex('Dumbbell Bench Press'), ex('Cable Row'), ex('Barbell Curl', { group: 'y' })]);
    expect(out.map((e) => [e.name, e.group ?? null])).toEqual([['Dumbbell Bench Press', 'x'], ['Cable Row', 'y'], ['Barbell Curl', 'y']]);
  });
  it('one removed exercise, two new ones: the pairing is unknown, so neither takes the group', () => {
    const before = [ex('Barbell Bench Press', { group: 'x' }), ex('Barbell Row', { group: 'x' })];
    const out = keepGroups(before, [ex('Dumbbell Bench Press'), ex('Cable Row'), ex('Barbell Row', { group: 'x' })]);
    expect(out.map((e) => [e.name, e.group ?? null])).toEqual([['Dumbbell Bench Press', null], ['Cable Row', null], ['Barbell Row', 'x']]);
  });
});

describe('pick: an explicit null is a change', () => {
  it('base absent, this device null, server a group: null wins (ADR 012, explicit null beats the server value)', () => {
    const b = row([g('A', undefined), g('B', undefined)]);
    const out = mergeWorkout(b, row([g('A', null), g('B', null)]), row([g('A', 'x'), g('B', 'x')]));
    expect(names(out)).toEqual([['A', null], ['B', null]]);
  });
});
