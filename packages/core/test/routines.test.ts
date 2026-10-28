import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BALANCE_EXERCISE, ROUTINE_EXERCISES_MAX, routineFromSession, seededSession, startRoutine, type Exclusion, type StartRoutineInput } from '../src/index';

type Rec = { name: string; exercises: Record<string, unknown>[] };
const vectors = JSON.parse(readFileSync(resolve(__dirname, '../../api/test-vectors/routines.json'), 'utf8')) as {
  valid: { note: string; record: Rec }[];
  invalid: { note: string; field: string; record: Rec }[];
};

const BLANK = /^[\s​-‍⁠﻿]*$/u;
const cp = (s: string) => [...s].length;
/** The save-side limits of the vectors, as far as routineFromSession is responsible for them (exercises and sets). */
function exercisesValid(ex: Record<string, unknown>[]): boolean {
  return (
    ex.length >= 1 &&
    ex.length <= 50 &&
    Object.keys(ex).length <= 50 &&
    ex.every((e) => typeof e.name === 'string' && !BLANK.test(e.name) && cp(e.name) <= 200 && Number.isInteger(e.sets) && (e.sets as number) >= 1 && (e.sets as number) <= 20)
  );
}
const nameValid = (n: string) => !BLANK.test(n) && cp(n) >= 1 && cp(n) <= 60;

describe('routineFromSession (#1184)', () => {
  it('drops repeat names, keeping the first', () => {
    expect(routineFromSession([{ name: 'A', sets: 3 }, { name: 'B', sets: 4 }, { name: 'A', sets: 5 }])).toEqual([{ name: 'A', sets: 3 }, { name: 'B', sets: 4 }]);
  });
  it('caps at 50 exercises', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Ex ${i}`, sets: 3 }));
    const out = routineFromSession(many);
    expect(ROUTINE_EXERCISES_MAX).toBe(50);
    expect(out).toHaveLength(50);
    expect(out[49]?.name).toBe('Ex 49');
  });
  it('clamps sets to 1 to 20 and rounds', () => {
    expect(routineFromSession([0, 1, 20, 21, 2.6, -4, NaN].map((sets, i) => ({ name: `E${i}`, sets }))).map((e) => e.sets)).toEqual([1, 1, 20, 20, 3, 1, 1]);
  });
  it('returns [] when empty, and drops blank names', () => {
    expect(routineFromSession([])).toEqual([]);
    expect(routineFromSession([{ name: ' ​', sets: 3 }])).toEqual([]);
  });
  it('keeps unknown keys', () => {
    expect(routineFromSession([{ name: 'A', sets: 3, group: 'ss1', x: null }])).toEqual([{ name: 'A', sets: 3, group: 'ss1', x: null }]);
  });
  it.each(vectors.valid)('vector valid: $note', ({ record }) => {
    expect(nameValid(record.name)).toBe(true);
    expect(exercisesValid(record.exercises)).toBe(true);
    expect(routineFromSession(record.exercises as { name: string; sets: number }[])).toEqual(record.exercises);
  });
  it.each(vectors.invalid.filter((v) => v.field === 'name'))('vector invalid name: $note', ({ record }) => {
    expect(nameValid(record.name)).toBe(false);
  });
  it.each(vectors.invalid.filter((v) => ['exercises', 'exercises.sets'].includes(v.field) && v.record.exercises.length > 0))(
    'vector invalid: $note is valid after routineFromSession, or was not storable',
    ({ record }) => {
      const out = routineFromSession(record.exercises as { name: string; sets: number }[]);
      // fractional sets are rounded, a missing or string sets cannot be stored from a session (the type forbids it)
      if (record.exercises.every((e) => typeof e.sets === 'number')) expect(exercisesValid(out)).toBe(true);
    },
  );
  it('the empty vector: nothing to save', () => {
    const v = vectors.invalid.find((x) => x.note === 'no exercises');
    expect(routineFromSession(v?.record.exercises as never)).toEqual([]);
  });
});

const tags = {};
const base: StartRoutineInput = {
  routine: [{ name: 'Row', sets: 4 }, { name: 'Curl', sets: 3 }, { name: 'Gone', sets: 5 }],
  catalogue: ['Row', 'Curl'],
  date: '2026-05-13',
  where: 'gym',
  tags,
};

describe('startRoutine (#1184, decision D2)', () => {
  it('has no base, no mods and keeps the stored sets and order', () => {
    const s = startRoutine(base);
    expect(s.base).toBeUndefined();
    expect(s.mods).toEqual({ light: false, short: false, where: 'gym', deload: false, reentry: 0 });
    expect(s.exercises).toEqual([{ name: 'Row', sets: 4, bridge: false }, { name: 'Curl', sets: 3, bridge: false }, { name: 'Gone', sets: 5, bridge: false }]);
  });
  it('flags names missing from the catalogue, in order, but keeps them', () => {
    expect(startRoutine(base).missing).toEqual(['Gone']);
    expect(startRoutine({ ...base, catalogue: new Set(['Row']) }).missing).toEqual(['Curl', 'Gone']);
  });
  it('flags an excluded exercise as missing', () => {
    const exclusions: Exclusion[] = [{ scope: 'exercise', key: 'Curl', reason: 'pain', to: {}, done: false }];
    expect(startRoutine({ ...base, exclusions }).missing).toEqual(['Curl', 'Gone']);
  });
  it('a lighter check-in takes a set off, on top of the stored count', () => {
    const s = startRoutine({ ...base, ciChoice: 'light' });
    expect(s.mods.light).toBe(true);
    expect(s.exercises.map((e) => e.sets)).toEqual([3, 2, 4]);
  });
  it('a deload keeps about 60%', () => {
    const s = startRoutine({ ...base, deload: { from: '2026-05-10', until: '2026-05-16' } });
    expect(s.mods.deload).toBe(true);
    expect(s.exercises.map((e) => e.sets)).toEqual([3, 2, 3]);
  });
  it('re-entry of 30% lightens and is stored', () => {
    const s = startRoutine({ ...base, reentry: { from: '2026-05-10', until: '2026-05-16', pct: 0.3 } });
    expect(s.mods.reentry).toBe(0.3);
    expect(s.exercises.map((e) => e.sets)).toEqual([3, 2, 4]);
  });
  it('stored counts are floored at 3 and capped at 5 by sessionSets (pinned)', () => {
    expect(startRoutine({ ...base, routine: [{ name: 'A', sets: 1 }, { name: 'B', sets: 12 }] }).exercises.map((e) => e.sets)).toEqual([3, 5]);
  });
  it('a stored balance exercise keeps 2 sets; none is added for 60+ when not stored', () => {
    const p = { age: 65 } as never;
    const s = startRoutine({ ...base, profile: p, routine: [{ name: 'Row', sets: 4 }, { name: BALANCE_EXERCISE, sets: 9 }] });
    expect(s.exercises).toEqual([{ name: 'Row', sets: 4, bridge: false }, { name: BALANCE_EXERCISE, sets: 2, bridge: false }]);
    expect(startRoutine({ ...base, profile: p }).exercises.map((e) => e.name)).toEqual(['Row', 'Curl', 'Gone']);
  });
  it('behaves as seededSession for the same adjustments and counts', () => {
    const adj = { ciChoice: 'light' as const };
    const seeded = seededSession({ ...adj, base: 'x', seeded: [{ name: 'Row' }, { name: 'Curl' }], picks: ['Row', 'Curl'], date: base.date, where: 'gym', tags, lastSets: (n) => (n === 'Row' ? 4 : 3) });
    const r = startRoutine({ ...base, ...adj, routine: [{ name: 'Row', sets: 4 }, { name: 'Curl', sets: 3 }] });
    expect(r.exercises).toEqual(seeded.exercises);
    expect(r.mods).toEqual(seeded.mods);
  });
});
