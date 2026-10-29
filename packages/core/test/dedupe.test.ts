import { dedupeExercises, planImport, replaceAt, ROUTINE_SETS_MAX, type CantExercise, type ImportDay } from '../src/index';
import { loadGolden } from './helpers';

type Row = [string, number, string | null];
const g = loadGolden<{
  limits: { sets_max: number };
  dedupe: { note: string; ex: Row[]; out: Row[] }[];
  swap: { note: string; ex: [string, string | null][]; idx: number; pick: string | null; out: [string, string | null][] }[];
  import: { note: string; mapping: Record<string, string>; days: { date: string; title: string; sets: [string, number, number, string?][] }[]; sets: [string, number][]; groups?: Record<string, string> }[];
}>('dedupe');
const mk = (rows: Row[]) => rows.map(([name, sets, group]) => ({ name, sets, group }));
const ex = (name: string, group: string | null): CantExercise => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, group });

describe('dedupeExercises (#1340)', () => {
  it('the limit is the routine set limit', () => expect(g.limits.sets_max).toBe(ROUTINE_SETS_MAX));
  it.each(g.dedupe.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    expect(dedupeExercises(mk(c.ex)).map((e) => [e.name, e.sets, e.group ?? null])).toEqual(c.out);
  });
  it('keeps the first copy fields and does not mutate', () => {
    const a = { name: 'a', sets: 3, part: 1, note: 'x' };
    const input = [a, { name: 'a', sets: 2, part: 2, note: 'y' }];
    const copy = JSON.stringify(input);
    expect(dedupeExercises(input)).toEqual([{ name: 'a', sets: 5, part: 1, note: 'x' }]);
    expect(JSON.stringify(input)).toBe(copy);
  });
  it('treats a non-finite set count as 0', () => {
    expect(dedupeExercises([{ name: 'a', sets: 3 }, { name: 'a', sets: NaN }])).toEqual([{ name: 'a', sets: 3 }]);
    expect(dedupeExercises([{ name: 'a', sets: NaN }, { name: 'a', sets: 2 }]).map((e) => e.sets)).toEqual([2]);
  });
  it('is idempotent', () => {
    for (const c of g.dedupe) {
      const once = dedupeExercises(mk(c.ex));
      expect(dedupeExercises(once)).toEqual(once);
    }
  });
});

describe('replaceAt refuses a repeat (#1340)', () => {
  it.each(g.swap.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const got = replaceAt(c.ex.map(([n, gr]) => ex(n, gr)), [], c.idx, c.pick, { lifts: {}, date: '2026-10-08' });
    expect(got.exercises.map((e) => [e.name, e.group ?? null])).toEqual(c.out);
  });
  it('a refused pick keeps the sets and removes nothing', () => {
    const sets = [{ exercise: 'a', kind: 'work' as const, set_index: 0, done: true }];
    const got = replaceAt([ex('a', null), ex('b', null)], sets, 0, 'b', { lifts: {}, date: '2026-10-08' });
    expect(got).toEqual({ exercises: [ex('a', null), ex('b', null)], sets, changed: [], removed: [] });
  });
});

describe('workout import never makes one name twice (#1340)', () => {
  it.each(g.import.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const days: ImportDay[] = c.days.map((d) => ({ date: d.date, title: d.title, sets: d.sets.map(([exercise, w, reps, superset]) => ({ exercise, weightKg: w, reps, ...(superset ? { superset: `w|${superset}` } : {}) })) }));
    let n = 0;
    const plan = planImport(days, c.mapping, new Set(), () => `g${++n}`);
    const day = plan.days[0];
    expect(day?.sets.map((s) => [s.exercise, s.setIndex])).toEqual(c.sets);
    expect(day?.groups).toEqual(c.groups);
    // one entry per name, and set numbers run 0..n-1 per name
    const names = [...new Set(day?.sets.map((s) => s.exercise))];
    for (const name of names) expect(day?.sets.filter((s) => s.exercise === name).map((s) => s.setIndex)).toEqual([...day!.sets.filter((s) => s.exercise === name).keys()]);
  });
});
