import content from '../../../content/exercises.json';
import {
  addDays,
  candidates,
  cantSession,
  replaceAt,
  type CantDraft,
  type CantDuration,
  type CantExercise,
  type CantLifts,
  type Exclusion,
  type ExclusionReason,
  type ExclusionScope,
  type ExerciseTag,
  type LadderCatalog,
  type LiftRecord,
  type Where,
} from '../src/index';
import { metaTable, rng } from './prototype-plan';
import { loadLadders, type ProtoRule } from './prototype-ladders';

// No golden cases exist for the "can't do" sheet; the workout steps are checked against the prototype's
// own applyCant (with its replaceAt and newExercise) over random sessions, and by hand-worked tests.
const catalog = content as unknown as LadderCatalog & typeof content;
const { tags } = catalog;
const DATE = '2026-10-08';
const NAMES = Object.keys(tags);
const proto = loadLadders(metaTable(catalog.meta));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface TestSet {
  id: string;
  exercise: string;
  kind: 'work' | 'ramp';
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  done: boolean;
  rate: null;
  t: null;
  deleted_at?: string | null;
}

const ex = (name: string, more: Partial<CantExercise> = {}): CantExercise => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...more });
const set = (id: string, exercise: string, kind: 'work' | 'ramp', set_index: number, done: boolean): TestSet => ({ id, exercise, kind, set_index, weight_kg: done ? 20 : null, reps: done ? 8 : null, done, rate: null, t: null });
const blank = (exercise: string, set_index: number) => ({ exercise, kind: 'work', set_index, weight_kg: null, reps: null, done: false, rate: null, t: null });
const noLifts: CantLifts = { lifts: {}, date: DATE };

describe('replaceAt', () => {
  const session = [ex('Leg Press'), ex('Leg Curl', { bridge: true, form: 'yes', found_kg: 30, skip_ramp: true }), ex('Calf Raise')];
  const sets = [
    set('a0', 'Leg Press', 'work', 0, false),
    set('b0', 'Leg Curl', 'work', 0, false),
    set('b1', 'Leg Curl', 'work', 1, true),
    set('b2', 'Leg Curl', 'work', 2, false),
    set('b3', 'Leg Curl', 'work', 3, true),
    set('br0', 'Leg Curl', 'ramp', 0, false),
    set('c0', 'Calf Raise', 'work', 0, false),
  ];

  it('keeps ticked work sets (renumbered), ramp sets and fields, and adds the pick after', () => {
    const got = replaceAt(session, sets, 1, 'Seated Leg Curl', noLifts);
    expect(got.exercises.map((e) => e.name)).toEqual(['Leg Press', 'Leg Curl', 'Seated Leg Curl', 'Calf Raise']);
    expect(got.exercises[1]).toBe(session[1]);
    expect(got.exercises[2]).toEqual(ex('Seated Leg Curl'));
    expect(got.removed.map((s) => s.id)).toEqual(['b0', 'b2']);
    expect(got.changed).toEqual([{ ...sets[2], set_index: 0 }, { ...sets[4], set_index: 1 }]);
    expect(got.changed.every((s) => got.sets.includes(s))).toBe(true);
    expect(got.sets).toEqual([
      sets[0],
      { ...sets[2], set_index: 0 },
      { ...sets[4], set_index: 1 },
      sets[5],
      sets[6],
      blank('Seated Leg Curl', 0),
      blank('Seated Leg Curl', 1),
      blank('Seated Leg Curl', 2),
    ]);
    expect(sets[2]?.set_index).toBe(1); // inputs are not changed
  });

  it('keeps a ticked set that needs no renumbering as the same object', () => {
    const input = [set('x0', 'A', 'work', 0, true), set('x1', 'A', 'work', 1, false)];
    const got = replaceAt([ex('A')], input, 0, null, noLifts);
    expect(got.exercises.map((e) => e.name)).toEqual(['A']);
    expect(got.sets).toHaveLength(1);
    expect(got.sets[0]).toBe(input[0]);
    expect(got.removed.map((s) => s.id)).toEqual(['x1']);
    expect(got.changed).toEqual([]);
  });

  it('with no ticked work set, the pick takes the place and every set of the exercise goes', () => {
    const rs = [...sets.slice(0, 1), set('ar0', 'Leg Press', 'ramp', 0, true), ...sets.slice(1)];
    const got = replaceAt(session, rs, 0, 'Hack Squat', noLifts);
    expect(got.exercises.map((e) => e.name)).toEqual(['Hack Squat', 'Leg Curl', 'Calf Raise']);
    expect(got.removed.map((s) => s.id)).toEqual(['a0', 'ar0']); // a ticked ramp set does not keep it
    expect(got.sets.slice(-3)).toEqual([0, 1, 2].map((i) => blank('Hack Squat', i)));
  });

  it('with no ticked work set and no pick, the exercise is removed', () => {
    const got = replaceAt(session, sets, 2, null, noLifts);
    expect(got.exercises.map((e) => e.name)).toEqual(['Leg Press', 'Leg Curl']);
    expect(got.removed.map((s) => s.id)).toEqual(['c0']);
    expect(got.changed).toEqual([]);
    expect(got.sets).toHaveLength(sets.length - 1);
  });

  it('PINNED QUIRK (#267): a pick replacing a second-session exercise reads as part 1 (prototype newExercise has no part)', () => {
    const got = replaceAt([ex('A'), ex('B', { part: 2 })], [], 1, 'C', noLifts);
    expect(got.exercises[1]).toEqual(ex('C'));
  });

  it('leaves tombstoned sets as they are', () => {
    const dead = { ...set('d0', 'Leg Press', 'work', 0, true), deleted_at: '2026-10-08T10:00:00Z' };
    const got = replaceAt(session, [dead, ...sets], 0, null, noLifts);
    expect(got.sets[0]).toBe(dead);
    expect(got.removed.map((s) => s.id)).toEqual(['a0']);
  });

  it('the pick gets as many sets as its last session before today, at least 3', () => {
    const rec = (date: string, n: number, prev: LiftRecord | null = null): LiftRecord => ({ date, sets: Array.from({ length: n }, () => ({ w: 10, r: 8 })), prev });
    const count = (lifts: Record<string, LiftRecord>): number => replaceAt([ex('A')], [], 0, 'P', { lifts, date: DATE }).sets.length;
    expect(count({ P: rec('2026-10-01', 5) })).toBe(5);
    expect(count({ P: rec('2026-10-01', 2) })).toBe(3);
    expect(count({ P: rec(DATE, 6, rec('2026-10-01', 4)) })).toBe(4); // today's record: its prev
    expect(count({ P: rec(DATE, 6) })).toBe(3);
  });

  it('returns the workout unchanged for an index past the end', () => {
    const got = replaceAt(session, sets, 9, 'X', noLifts);
    expect(got).toEqual({ exercises: session, sets, changed: [], removed: [] });
  });
});

describe('cantSession', () => {
  const draft: CantDraft = { name: 'Leg Press', reason: 'pain', dur: '2w', scope: 'joint', key: 'knee' };

  it('replaces the tapped exercise only while it is still at i', () => {
    const w = [ex('Bench Press'), ex('Leg Press')];
    const s = [set('a', 'Bench Press', 'work', 0, false), set('b', 'Leg Press', 'work', 0, false)];
    const exerciseOnly: CantDraft = { name: 'Leg Press', reason: 'dislike', dur: 'perm' };
    expect(cantSession(w, s, 1, exerciseOnly, 'Hack Squat', 'gym', [], noLifts, catalog).exercises.map((e) => e.name)).toEqual(['Bench Press', 'Hack Squat']);
    const moved = cantSession(w, s, 0, exerciseOnly, 'Hack Squat', 'gym', [], noLifts, catalog);
    expect(moved).toEqual({ exercises: w, sets: s, changed: [], removed: [] });
    expect(cantSession(w, s, null, exerciseOnly, 'Hack Squat', 'gym', [], noLifts, catalog).exercises).toEqual(w);
  });

  it('replaces other exercises caught by a wider rule, except for a today answer', () => {
    const w = [ex('Leg Press'), ex('Goblet Squat'), ex('Bench Press')];
    const s = w.map((e, k) => set(`s${k}`, e.name, 'work', 0, false));
    const got = cantSession(w, s, 0, draft, null, 'gym', [], noLifts, catalog);
    const rule: Exclusion = { scope: 'joint', key: 'knee', reason: 'pain', to: {}, done: false };
    const c = candidates('Goblet Squat', { where: 'gym', joint: 'knee', pain: true, inSession: ['Goblet Squat', 'Bench Press'] }, [rule], {}, catalog);
    expect(got.exercises.map((e) => e.name)).toEqual([...(c[0] ? [c[0].name] : []), 'Bench Press']);
    expect(got.removed.map((x) => x.id)).toEqual(['s0', 's1']);
    const today = cantSession(w, s, 0, { name: 'Leg Press', reason: 'pain', dur: 'today' }, null, 'gym', [], noLifts, catalog);
    expect(today.exercises.map((e) => e.name)).toEqual(['Goblet Squat', 'Bench Press']);
  });

  it('matches prototype applyCant (exercises, kept, removed and new sets) on 3,000 random sessions', () => {
    const r = rng(265);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const SCOPES: ExclusionScope[] = ['exercise', 'family', 'pattern', 'joint'];
    const REASONS: ExclusionReason[] = ['pain', 'equip', 'dislike', 'form'];
    const WHERES: Where[] = ['gym', 'dumbbells', 'bodyweight'];
    let kept = 0;
    let changedSeen = 0;
    let wider = 0;
    for (let k = 0; k < 3000; k++) {
      const where = pick(WHERES);
      const names = [...new Set(Array.from({ length: 6 }, () => pick(NAMES)))];
      let id = 0;
      const exercises = names.map((name) => ex(name, { part: r() < 0.2 ? 2 : 1, bridge: r() < 0.1, form: pick(['yes', 'no', null] as const), found_kg: r() < 0.2 ? 40 : null, skip_ramp: r() < 0.1 }));
      const sets: TestSet[] = names.flatMap((name) => {
        const work = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, j) => set(`s${id++}`, name, 'work', j, r() < 0.15));
        const ramp = r() < 0.2 ? Array.from({ length: 1 + Math.floor(r() * 2) }, (_, j) => set(`s${id++}`, name, 'ramp', j, r() < 0.5)) : [];
        return [...work, ...ramp];
      });
      const i = r() < 0.85 ? Math.floor(r() * names.length) : null;
      const name = i === null ? pick(NAMES) : (names[i] as string);
      const t = tags[name as keyof typeof tags] as ExerciseTag;
      const dur: CantDuration = pick(i === null ? (['2w', '4w', 'perm'] as const) : (['today', '2w', '4w', 'perm'] as const));
      const opts: [ExclusionScope, string][] = [['exercise', name], ['family', t.family], ['pattern', t.pattern], ...t.joints.map((j) => ['joint', j] as [ExclusionScope, string])];
      const [scope, key] = dur === 'today' ? (['exercise', name] as const) : r() < 0.1 ? (['', ''] as const) : pick(opts);
      const reason = pick(REASONS);
      // saved rules of every scope, some answered (done), so wider existing rules meet the new one
      const existing: Exclusion[] = Array.from({ length: Math.floor(r() * 3) }, (_, n) => {
        const on = pick(NAMES);
        const ot = tags[on as keyof typeof tags] as ExerciseTag;
        const sc = pick(SCOPES);
        const ky = sc === 'exercise' ? on : sc === 'family' ? ot.family : sc === 'pattern' ? ot.pattern : pick(ot.joints.length ? ot.joints : ['knee']);
        return { id: `r${n}`, scope: sc, key: ky, reason: pick([null, ...REASONS]), to: {}, done: r() < 0.2, until: null };
      });
      const lifts: Record<string, LiftRecord> = Object.fromEntries(
        NAMES.filter(() => r() < 0.1).map((n) => {
          const sessionOf = (date: string) => ({ date, sets: Array.from({ length: 1 + Math.floor(r() * 6) }, () => ({ w: 10, r: 8 })) });
          return [n, r() < 0.3 ? { ...sessionOf(DATE), prev: r() < 0.5 ? sessionOf('2026-10-01') : null } : sessionOf(pick(['2026-10-01', addDays(DATE, 1)]))];
        }),
      );
      const draft: CantDraft = { name, reason, dur, scope: (scope || null) as ExclusionScope | null, key: key || null };
      const draftRule = { scope: (scope || 'exercise') as ExclusionScope, key: key || name, reason };
      const cands = candidates(name, { where, rules: [draftRule], joint: draftRule.scope === 'joint' ? draftRule.key : null, pain: reason === 'pain', form: reason === 'form', inSession: i === null ? [] : names }, existing, lifts, catalog);
      const choice = r() < 0.2 ? null : cands[0] ? pick(cands).name : null;

      const protoEx = exercises.map((e) => {
        const rows = (kind: 'work' | 'ramp') => sets.filter((s) => s.exercise === e.name && s.kind === kind).map((s) => ({ id: s.id, w: s.done ? '20' : '', r: s.done ? '8' : '', done: s.done }));
        const ramp = rows('ramp');
        return { name: e.name, sets: rows('work'), ...(e.part === 2 ? { part: 2 } : {}), ...(e.bridge ? { bridge: true } : {}), form: e.form, found: e.found_kg, skipRamp: e.skip_ramp, ...(ramp.length ? { ramp } : {}) };
      });
      Object.assign(proto.S, { date: DATE, where, lifts: clone(lifts), day: { workout: { where, exercises: protoEx } } });
      proto.S.settings = { excl: existing.map((x) => clone({ id: x.id, scope: x.scope, key: x.key, reason: x.reason, until: null, to: x.to, done: x.done }) as ProtoRule), repl: {}, returning: {}, ladderStay: {}, adj: {}, ex: {} };
      Object.assign(proto.CX, { i, name, step: 'pick', reason, dur, scope, key });
      proto.applyCant(choice);

      const got = cantSession(exercises, sets, i, draft, choice, where, existing, { lifts, date: DATE }, catalog);
      type PE = { name: string; part?: number; bridge?: boolean; form?: 'yes' | 'no' | null; found?: number | null; skipRamp?: boolean; sets: { id?: string; done: boolean }[]; ramp?: { id?: string; done: boolean }[] };
      const after = proto.S.day.workout.exercises as unknown as PE[];
      expect(got.exercises).toEqual(after.map((e) => ({ name: e.name, part: e.part === 2 ? 2 : 1, bridge: !!e.bridge, form: e.form ?? null, found_kg: e.found ?? null, skip_ramp: !!e.skipRamp })));
      const key2 = (s: { exercise: string; kind: string; set_index: number }): string => `${s.exercise}|${s.kind}|${s.set_index}`;
      const protoSets = after.flatMap((e) => (['work', 'ramp'] as const).flatMap((kind) => ((kind === 'work' ? e.sets : e.ramp) || []).map((s, j) => ({ id: s.id ?? null, exercise: e.name, kind, set_index: j, done: s.done }))));
      const mine = got.sets.map((s) => ({ id: 'id' in s ? s.id : null, exercise: s.exercise, kind: s.kind, set_index: s.set_index, done: s.done }));
      expect(mine.sort((a, b) => key2(a).localeCompare(key2(b)))).toEqual(protoSets.sort((a, b) => key2(a).localeCompare(key2(b))));
      const ids = new Set(protoSets.map((s) => s.id));
      expect(got.removed.map((s) => s.id).sort()).toEqual(sets.filter((s) => !ids.has(s.id)).map((s) => s.id).sort());
      // changed: exactly the kept input sets whose fields differ from the input
      const byId = new Map(sets.map((s) => [s.id, s]));
      const differs = got.sets.filter((s): s is TestSet => 'id' in s && byId.get(s.id) !== s);
      expect(got.changed).toEqual(differs);
      for (const s of got.changed) expect(s).not.toEqual(byId.get(s.id));
      changedSeen += got.changed.length;
      if (i !== null && got.exercises.some((e) => e.name === name) && choice) kept++;
      if (got.removed.some((s) => s.exercise !== name)) wider++;
    }
    expect(kept).toBeGreaterThan(100);
    expect(wider).toBeGreaterThan(300);
    expect(changedSeen).toBeGreaterThan(100);
  });
});
