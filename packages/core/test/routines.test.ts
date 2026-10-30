import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeGroups } from '../src/groups';
import { adjustSets, BALANCE_EXERCISE, isBlank, ROUTINE_EXERCISES_MAX, ROUTINE_MAX_LIVE, ROUTINE_NAME_MAX, ROUTINE_SETS_MAX, ROUTINE_SETS_MIN, missingExercises, routineFromSession, seededSession, startRoutine, type Exclusion, type StartRoutineInput } from '../src/index';

type Rec = { name: string; exercises: Record<string, unknown>[] };
const vectors = JSON.parse(readFileSync(resolve(__dirname, '../../api/test-vectors/routines.json'), 'utf8')) as {
  valid: { note: string; record: Rec }[];
  invalid: { note: string; field: string; record: Rec }[];
  limits: { name_max: number; exercises_max: number; sets_min: number; sets_max: number; max_exercise_keys: number; max_live_routines: number };
  cap: { cases: { live: number; push: string[]; refused: number[] }[] };
};
const blankVectors = JSON.parse(readFileSync(resolve(__dirname, '../../api/test-vectors/blank-text.json'), 'utf8')) as { must_fail: string[]; must_pass: string[] };

const cp = (s: string) => [...s].length;
/** The save-side limits of the vectors, as far as routineFromSession is responsible for them (exercises and sets). */
function exercisesValid(ex: Record<string, unknown>[]): boolean {
  return (
    ex.length >= 1 &&
    ex.length <= 50 &&
    ex.every((e) => Object.keys(e).length <= vectors.limits.max_exercise_keys) &&
    ex.every((e) => typeof e.name === 'string' && !isBlank(e.name) && cp(e.name) <= 200 && Number.isInteger(e.sets) && (e.sets as number) >= 1 && (e.sets as number) <= 20)
  );
}
const nameValid = (n: string) => !isBlank(n) && cp(n) >= 1 && cp(n) <= 60;

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
  it('outputs exactly { name, sets }: no part, arrays or nulls', () => {
    const e = { name: 'A', sets: 3, part: 1, ramp: [], form: null };
    expect(routineFromSession([e])).toEqual([{ name: 'A', sets: 3 }]);
    expect(Object.keys(routineFromSession([e])[0] as object)).toEqual(['name', 'sets']);
  });
  it.each(vectors.valid)('vector valid: $note', ({ note, record }) => {
    expect(nameValid(record.name)).toBe(true);
    expect(exercisesValid(record.exercises)).toBe(true);
    // group ids are remapped (g1, ...): a run of 2+ gets g1, a null or single member gets no key
    const out = routineFromSession(record.exercises as { name: string; sets: number }[]);
    expect(out.map((e) => ({ name: e.name, sets: e.sets }))).toEqual(record.exercises.map((e) => ({ name: e.name, sets: e.sets })));
    const expected = note === 'group id of 36 characters' ? ['g1', 'g1'] : record.exercises.map(() => undefined);
    expect(out.map((e) => ('group' in e ? e.group : undefined))).toEqual(expected);
    expect(out.every((e) => !('group' in e) || e.group !== null)).toBe(true);
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
    expect(startRoutine(base).missing).toEqual([{ name: 'Gone', reason: 'unknown' }]);
    expect(startRoutine({ ...base, catalogue: new Set(['Row']) }).missing).toEqual([{ name: 'Curl', reason: 'unknown' }, { name: 'Gone', reason: 'unknown' }]);
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
  it('keeps stored counts as saved: no floor, cap, ramp, calf bump or balance override', () => {
    const p = { age: 65, exp: 'new', start: '2026-05-10' } as never;
    const r = [{ name: 'A', sets: 1 }, { name: 'B', sets: 12 }, { name: 'Calf Raise', sets: 2 }, { name: 'C', sets: 20 }];
    expect(startRoutine({ ...base, routine: r, profile: p, tags: { 'Calf Raise': { pattern: 'calf' } } as never }).exercises.map((e) => e.sets)).toEqual([1, 12, 2, 20]);
  });
  it('duplicate stored names become one exercise with the counts merged (#1340: a session never repeats a name)', () => {
    expect(startRoutine({ ...base, routine: [{ name: 'Row', sets: 4 }, { name: 'Row', sets: 3 }] }).exercises.map((e) => [e.name, e.sets])).toEqual([['Row', 7]]);
  });
  it('lab hold is not applied to a routine session', () => {
    const s = startRoutine({ ...base, labHold: true } as StartRoutineInput);
    expect(s.mods.light).toBe(false);
    expect(s.exercises.map((e) => e.sets)).toEqual([4, 3, 5]);
  });
  it('missing carries a reason', () => {
    const exclusions: Exclusion[] = [{ scope: 'exercise', key: 'Curl', reason: 'pain', to: {}, done: false }];
    expect(startRoutine({ ...base, exclusions }).missing).toEqual([{ name: 'Curl', reason: 'excluded' }, { name: 'Gone', reason: 'unknown' }]);
  });
  it('a stored balance exercise is just a stored count', () => {
    const s = startRoutine({ ...base, routine: [{ name: 'Row', sets: 4 }, { name: BALANCE_EXERCISE, sets: 9 }] });
    expect(s.exercises.map((e) => e.sets)).toEqual([4, 9]);
  });
  it('behaves as seededSession for the same adjustments and counts', () => {
    const adj = { ciChoice: 'light' as const };
    const seeded = seededSession({ ...adj, base: 'x', seeded: [{ name: 'Row' }, { name: 'Curl' }], picks: ['Row', 'Curl'], date: base.date, where: 'gym', tags, lastSets: (n) => (n === 'Row' ? 4 : 3) });
    const r = startRoutine({ ...base, ...adj, routine: [{ name: 'Row', sets: 4 }, { name: 'Curl', sets: 3 }] });
    expect(r.exercises).toEqual(seeded.exercises);
    expect(r.mods).toEqual(seeded.mods);
  });
});

describe('isBlank and adjustSets', () => {
  it.each(['', ' ', '\t\n', '\u0085', '\u00A0', '\u200B', '\u200D', '\u2060', '\uFEFF', '\u3000', ' \u200B '])('blank %j', (t) => expect(isBlank(t)).toBe(true));
  it.each(['a', ' a ', '\u200Bx', '0'])('not blank %j', (t) => expect(isBlank(t)).toBe(false));
  it.each(blankVectors.must_fail.map((t) => [t]))('contract must_fail %j is blank', (t) => expect(isBlank(t)).toBe(true));
  it.each(blankVectors.must_pass.map((t) => [t]))('contract must_pass %j is not blank', (t) => expect(isBlank(t)).toBe(false));
  it('adjustSets: deload ~60% min 2 never above n, light drops one above 2, deload wins', () => {
    expect([1, 2, 5, 10].map((n) => adjustSets(n, { deload: true }))).toEqual([1, 2, 3, 6]);
    expect([2, 3].map((n) => adjustSets(n, { light: true }))).toEqual([2, 2]);
    expect(adjustSets(5, { deload: true, light: true })).toBe(3);
    expect(adjustSets(5, {})).toBe(5);
  });
});

describe('routine limits pinned to routines.json', () => {
  it('match the contract', () => {
    expect(ROUTINE_NAME_MAX).toBe(vectors.limits.name_max);
    expect(ROUTINE_MAX_LIVE).toBe(vectors.limits.max_live_routines);
    expect(ROUTINE_EXERCISES_MAX).toBe(vectors.limits.exercises_max);
    expect(ROUTINE_SETS_MIN).toBe(vectors.limits.sets_min);
    expect(ROUTINE_SETS_MAX).toBe(vectors.limits.sets_max);
  });
  it('name vectors sit on ROUTINE_NAME_MAX', () => {
    for (const { record } of vectors.valid) expect(cp(record.name)).toBeLessThanOrEqual(ROUTINE_NAME_MAX);
    expect(vectors.valid.some((v) => cp(v.record.name) === ROUTINE_NAME_MAX)).toBe(true);
    expect(vectors.invalid.some((v) => v.field === 'name' && cp(v.record.name) === ROUTINE_NAME_MAX + 1)).toBe(true);
  });
  it('cap scenarios turn on ROUTINE_MAX_LIVE', () => {
    expect(vectors.cap.cases.find((x) => x.live === ROUTINE_MAX_LIVE && x.push.join() === 'new')?.refused).toEqual([0]);
    expect(vectors.cap.cases.find((x) => x.live === ROUTINE_MAX_LIVE - 1 && x.push.join() === 'new,new')?.refused).toEqual([1]);
  });
});

describe('missingExercises', () => {
  const exclusions: Exclusion[] = [{ scope: 'exercise', key: 'Curl', reason: 'pain', to: {}, done: false }];
  it('returns unknown and excluded names in input order, with the reason', () => {
    expect(missingExercises(['Gone', 'Row', 'Curl'], { catalogue: ['Row', 'Curl'], exclusions, tags })).toEqual([{ name: 'Gone', reason: 'unknown' }, { name: 'Curl', reason: 'excluded' }]);
  });
  it('a name not in the catalogue is unknown even when a rule covers it; a Set catalogue works; no rules means none excluded', () => {
    const rule: Exclusion[] = [{ scope: 'exercise', key: 'Gone', reason: 'pain', to: {}, done: false }];
    expect(missingExercises(['Gone'], { catalogue: new Set(['Row']), exclusions: rule, tags })).toEqual([{ name: 'Gone', reason: 'unknown' }]);
    expect(missingExercises(['Curl'], { catalogue: ['Curl'], tags })).toEqual([]);
  });
});

describe('routine groups (#1182 S6a, ADR 012)', () => {
  const ex = (name: string, group?: string | null) => (group === undefined ? { name, sets: 3 } : { name, sets: 3, group });
  it('keeps groups as local ids g1, g2 in order of first appearance; ungrouped get no key', () => {
    const out = routineFromSession([ex('A', 'zz'), ex('B', 'zz'), ex('C'), ex('D', 'qq'), ex('E', 'qq')]);
    expect(out.map((e) => e.group)).toEqual(['g1', 'g1', undefined, 'g2', 'g2']);
    expect('group' in (out[2] as object)).toBe(false);
  });
  it('is byte-identical to the old output for ungrouped sessions, and ignores group null', () => {
    expect(JSON.stringify(routineFromSession([ex('A'), ex('B', null)]))).toBe('[{"name":"A","sets":3},{"name":"B","sets":3}]');
  });
  it('drops a broken group (singleton, bad id, split id)', () => {
    expect(routineFromSession([ex('A', 'x'), ex('B'), ex('C', 'bad id'), ex('D', 'y'), ex('E'), ex('F', 'y')]).some((e) => 'group' in e)).toBe(false);
  });
  it('a dedupe or cap that breaks a group dissolves it', () => {
    expect(routineFromSession([ex('A', 'x'), ex('A', 'x'), ex('B')]).some((e) => 'group' in e)).toBe(false);
    const many = [...Array.from({ length: 49 }, (_, i) => ex(`E${i}`)), ex('L1', 'x'), ex('L2', 'x')];
    expect(routineFromSession(many).some((e) => 'group' in e)).toBe(false);
    expect(routineFromSession([ex('A', 'x'), ex('', 'x'), ex('B', 'x')]).map((e) => e.group)).toEqual(['g1', 'g1']);
  });
  it('a group split by an exercise that is later dropped stays dissolved', () => {
    expect(routineFromSession([ex('A', 'x'), ex('', 'y'), ex('B', 'x')]).some((e) => 'group' in e)).toBe(false);
  });
  it('output groups match the contract pattern', () => {
    for (const e of routineFromSession([ex('A', 'x'), ex('B', 'x')])) expect(e.group).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
  });
  describe('startRoutine', () => {
    const input = (routine: StartRoutineInput['routine'], newId?: () => string): StartRoutineInput => ({
      date: '2026-01-05', ciChoice: 'ok', where: 'gym', deload: false, reentry: false, tags: {}, catalogue: ['A', 'B', 'C', 'D'], routine, ...(newId ? { newId } : {}),
    } as unknown as StartRoutineInput);
    const routine = [ex('A', 'g1'), ex('B', 'g1'), ex('C'), ex('D', 'g1')];
    it('gives each start fresh ids, never the stored one', () => {
      let n = 0;
      const gen = () => `s${++n}`;
      const r = [ex('A', 'g1'), ex('B', 'g1'), ex('C', 'g2'), ex('D', 'g2')];
      const a = startRoutine(input(r, gen)).exercises.map((e) => e.group);
      const b = startRoutine(input(r, gen)).exercises.map((e) => e.group);
      expect(a).toEqual(['s1', 's1', 's2', 's2']);
      expect(b).toEqual(['s3', 's3', 's4', 's4']);
    });
    it('drops invalid stored groups (split id) and ungrouped keep no key', () => {
      const out = startRoutine(input(routine, () => 'n')).exercises;
      expect(out.some((e) => 'group' in e)).toBe(false);
    });
    describe('guards newId', () => {
      const r = [ex('A', 'x'), ex('B', 'x'), ex('C', 'y'), ex('D', 'y'), ex('E', 'z'), ex('F', 'z'), ex('G', 'z'), ex('H', 'z')];
      const cat = (id: () => string) => ({ ...input(r, id), catalogue: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }) as StartRoutineInput;
      const groups = (id: () => string) => startRoutine(cat(id)).exercises.map((e) => ('group' in e ? e.group : undefined));
      const none = Array(8).fill(undefined);
      it.each([['empty', ''], ['a space', 'a b'], ['37 characters', 'a'.repeat(37)], ['not a string', 5 as unknown as string]])('an id that is %s leaves every group ungrouped', (_n, bad) => {
        const out = startRoutine(cat(() => bad)).exercises;
        expect(groups(() => bad)).toEqual(none);
        expect(out.some((e) => 'group' in e)).toBe(false);
      });
      it('a repeated id keeps the first group and ungroups the next, so runs never merge', () => {
        expect(groups(() => 'same')).toEqual(['same', 'same', ...Array(6).fill(undefined)]);
      });
      it('an id that comes back later (q, p, q) ungroups only the repeat', () => {
        const q = ['q', 'p', 'q'];
        let n = 0;
        expect(groups(() => q[n++] as string)).toEqual(['q', 'q', 'p', 'p', undefined, undefined, undefined, undefined]);
      });
      it('a newId that throws leaves that group ungrouped, the others keep theirs', () => {
        let n = 0;
        expect(
          groups(() => {
            if (++n === 2) throw new Error('boom');
            return `s${n}`;
          }),
        ).toEqual(['s1', 's1', undefined, undefined, 's3', 's3', 's3', 's3']);
      });
      it('a 36-character UUID-shaped id works', () => {
        const id = '123e4567-e89b-12d3-a456-426614174000';
        expect(id).toHaveLength(36);
        let n = 0;
        const out = groups(() => (n++ === 0 ? id : `s${n}`));
        expect(out.slice(0, 2)).toEqual([id, id]);
      });
      it('the output stays a fixed point of normalizeGroups', () => {
        const out = startRoutine(cat(() => 'same')).exercises;
        expect(normalizeGroups(out)).toEqual(out);
      });
    });
    it('without newId, or for an ungrouped routine, output is unchanged', () => {
      const r = [ex('A', 'g1'), ex('B', 'g1')];
      expect(startRoutine(input(r)).exercises.some((e) => 'group' in e)).toBe(false);
      expect(startRoutine(input([ex('A'), ex('B')], () => 'n')).exercises[0]).toEqual({ name: 'A', sets: 3, bridge: false });
    });
  });
});
