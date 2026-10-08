import content from '../../../content/exercises.json';
import {
  applyCustomTags,
  applyMods,
  customExerciseMeta,
  DEFAULT_STEP,
  easier,
  exInfo,
  harder,
  kgLabel,
  lastFor,
  metaFor,
  overridesFromSettings,
  rampRate,
  rampTickFill,
  setTarget,
  snap,
  suggestBase,
  tickFill,
  type ExerciseCatalog,
  type ExerciseTag,
  type ExerciseOverride,
  type LiftRecord,
  type ModsContext,
  type Rate,
  type SetEntry,
  type Suggestion,
  type Where,
} from '../src/index';
import { loadGolden } from './helpers';
import { metaTable, rng, shortTag, type MetaTable } from './prototype-plan';
import { loadCustomTags, loadProgression, prototypeExMeta } from './prototype-progression';

interface GoldenProgression {
  exerciseMeta: MetaTable;
  defaultStep: Record<string, number>;
  cases: { input: { id: string; name: string; last: LiftRecord }; output: { mode: string; weight?: number | ''; reps: number; text: string } }[];
}

const golden = loadGolden<GoldenProgression>('progression');
// The port reads EX_META from content/exercises.json; content.test.ts checks it equals the fixture's exerciseMeta.
const catalog: ExerciseCatalog = content;
// The fixture does not record S.date. Any date from 2026-10-02 (after last.date) to 2026-10-11 (less
// than 14 days after first-2-weeks-hold's first) reproduces it; the spec is dated 2026-10-07.
const DATE = '2026-10-07';
const ctx = (name: string, last: LiftRecord, more: Partial<ModsContext> = {}): ModsContext => ({ date: DATE, lifts: { [name]: last }, catalog, ...more });
const rec = (sets: [number, number, Rate?][], more: Partial<LiftRecord> = {}): LiftRecord => ({ date: '2026-10-01', first: '2026-08-01', sets: sets.map(([w, r, rate]) => ({ w, r, ...(rate ? { rate } : {}) })), ...more });
const sug = (name: string, last: LiftRecord, more: Partial<ModsContext> = {}) => suggestBase({ name }, ctx(name, last, more));

describe('suggestBase: golden/progression.json', () => {
  it('has 8 cases', () => {
    expect(golden.cases).toHaveLength(8);
  });

  it.each(golden.cases.map((c) => [c.input.id, c] as const))('%s', (_id, c) => {
    const s = suggestBase({ name: c.input.name }, ctx(c.input.name, c.input.last));
    expect({ mode: s.mode, weight: s.w, reps: s.reps, text: s.text }).toEqual(c.output);
  });

  it('reproduces every case for any date the fixture allows', () => {
    for (const d of ['2026-10-02', '2026-10-11'])
      for (const c of golden.cases) expect(suggestBase({ name: c.input.name }, { date: d, lifts: { [c.input.name]: c.input.last }, catalog }).text).toBe(c.output.text);
  });

  it('DEFAULT_STEP and the fixture meta match the prototype tables', () => {
    expect(DEFAULT_STEP).toEqual(golden.defaultStep);
    expect(prototypeExMeta()).toEqual(golden.exerciseMeta);
  });
});

describe('suggestBase rules', () => {
  it('first time: no weight, range bottom', () => {
    expect(suggestBase({ name: 'Hack Squat' }, { date: DATE, lifts: {}, catalog })).toEqual({ mode: 'new', reps: 8, text: '8–12 reps', reason: '' });
    expect(suggestBase({ name: 'Plank (seconds)' }, { date: DATE, lifts: {}, catalog })).toMatchObject({ mode: 'bw-new', reps: 20, text: '20–60 sec' });
  });

  it('drops after two low sessions running', () => {
    const s = sug('Hack Squat', rec([[60, 6], [60, 5]], { prev: { date: '2026-09-28', sets: [{ w: 60, r: 7 }] } }));
    expect(s).toMatchObject({ mode: 'down', w: 55, reps: 8 });
    expect(s.reason).toContain('two sessions running');
    expect(sug('Hack Squat', rec([[60, 6], [60, 5]]))).toMatchObject({ mode: 'hold', w: 60, reps: 8 });
  });

  it('Hard on a top set holds; all Easy skips the 2-week hold', () => {
    expect(sug('Hack Squat', rec([[60, 12, 'hard'], [60, 12]]))).toMatchObject({ mode: 'hold', reps: 12 });
    expect(sug('Hack Squat', rec([[60, 12, 'easy'], [60, 12, 'easy']], { first: '2026-10-01' }))).toMatchObject({ mode: 'up', w: 65 });
  });

  it('2-week hold counts whole calendar days, also across a DST change (prototype: local Date difference)', () => {
    // 2026-02-28 → 2026-03-14 spans the US clock change (2026-03-08): day 14, so no longer held.
    const L = rec([[60, 12], [60, 12]], { date: '2026-03-10', first: '2026-02-28' });
    expect(suggestBase({ name: 'Hack Squat' }, { date: '2026-03-13', lifts: { 'Hack Squat': L }, catalog })).toMatchObject({ mode: 'hold' });
    expect(suggestBase({ name: 'Hack Squat' }, { date: '2026-03-14', lifts: { 'Hack Squat': L }, catalog })).toMatchObject({ mode: 'up', w: 65 });
  });

  it('jump warning over 10%, or 5% at 60+', () => {
    expect(sug('Hack Squat', rec([[60, 12], [60, 12]])).reason).not.toContain('jump');
    expect(sug('Hack Squat', rec([[60, 12], [60, 12]]), { profile: { age: 60 } }).reason).toContain('8% jump');
  });

  it('home dumbbells raise the range to at least 10–20; user settings win', () => {
    expect(exInfo('Lateral Raise', catalog, null, 'dumbbells')).toEqual({ type: 'dumbbell', lo: 12, hi: 20, step: 2.5 });
    expect(exInfo('Lateral Raise', catalog, { lo: 8 }, 'dumbbells')).toEqual({ type: 'dumbbell', lo: 8, hi: 15, step: 2.5 });
    expect(exInfo('Hack Squat', catalog, { type: 'machine', step: 0 })).toEqual({ type: 'machine', lo: 8, hi: 12, step: 0 });
    expect(exInfo('Mystery', catalog)).toEqual({ type: 'other', lo: 8, hi: 12, step: 2.5 });
  });

  it('weighted bodyweight at the top of the range', () => {
    expect(sug('Push-ups', rec([[10, 20], [10, 20]]))).toMatchObject({ mode: 'bw', w: 10, reps: 20, text: '20+ reps' });
  });

  it('lastFor skips today’s record', () => {
    const L = rec([[60, 10]], { date: DATE, prev: { date: '2026-10-01', sets: [] } });
    expect(lastFor('Hack Squat', { 'Hack Squat': L }, DATE)).toBe(L.prev);
    expect(lastFor('Hack Squat', { 'Hack Squat': { ...L, prev: null } }, DATE)).toBeNull();
  });
});

describe('applyMods', () => {
  const up = (more: Partial<ModsContext>, name = 'Hack Squat', ex: { bridge?: boolean } = {}) => {
    const c = ctx(name, rec([[60, 12], [60, 12]]), more);
    return applyMods(suggestBase({ name }, c), { name, ...ex }, c);
  };

  it('returning: 55% of the old top for 2 weeks', () => {
    expect(up({ returning: { 'Hack Squat': { until: DATE } } })).toMatchObject({ mode: 'hold', w: 35, text: '35 kg × 8–12 reps' });
    expect(up({ returning: { 'Hack Squat': { until: '2026-10-06' } } })).toMatchObject({ mode: 'up', w: 65 });
  });

  it('bridge: 85% of the old top', () => {
    expect(up({}, 'Hack Squat', { bridge: true })).toMatchObject({ mode: 'hold', w: 50 });
  });

  it('light, deload and re-entry stop increases; deload −10%, re-entry −15% or −30%', () => {
    expect(up({ mods: { light: true } })).toMatchObject({ w: 60, mode: 'hold' });
    expect(up({ mods: { deload: true } })).toMatchObject({ w: 55 });
    expect(up({ mods: { reentry: 0.15 } }).w).toBe(50);
    expect(up({ mods: { reentry: 0.3 } })).toMatchObject({ w: 40 });
    expect(up({ mods: { reentry: 0.3 } }).reason).toContain('about 30% lighter');
  });

  it('assisted: more assistance instead of less weight', () => {
    const c = ctx('Assisted Pull-up', rec([[30, 8], [30, 8]]), { mods: { deload: true } });
    expect(applyMods(suggestBase({ name: 'Assisted Pull-up' }, c), { name: 'Assisted Pull-up' }, c).w).toBe(35);
  });

  it('passes through bodyweight, first-time and unchanged suggestions', () => {
    const bw = sug('Push-ups', rec([[0, 10]]));
    expect(applyMods(bw, { name: 'Push-ups' }, ctx('Push-ups', rec([[0, 10]]), { mods: { deload: true } }))).toBe(bw);
    const hold = sug('Hack Squat', rec([[60, 10]]));
    expect(applyMods(hold, { name: 'Hack Squat' }, ctx('Hack Squat', rec([[60, 10]])))).toBe(hold);
    const w5: Suggestion = { mode: 'hold', w: 5, reps: 8, text: '', reason: '' };
    expect(applyMods(w5, { name: 'Bodyweight Squat' }, ctx('x', rec([])))).toBe(w5);
    expect(applyMods(w5, { name: 'Hack Squat' }, { date: DATE, lifts: {}, catalog })).toBe(w5);
  });
});

describe('in-session: setTarget and ticking', () => {
  const info = exInfo('Hack Squat', catalog);
  const base: Suggestion = { mode: 'hold', w: 60, reps: 10, text: '', reason: '' };
  const done = (w: string, r: string, rate?: Rate): SetEntry => ({ w, r, done: true, ...(rate ? { rate } : {}) });

  it('Easy → +1 step; Couldn’t finish → −10%; Hard → same; else suggested reps', () => {
    expect(setTarget([done('60', '10', 'easy')], 1, base, info)).toEqual({ w: 65, r: 10 });
    expect(setTarget([done('60', '6', 'fail')], 1, base, info)).toEqual({ w: 55, r: 8 });
    expect(setTarget([done('60', '9', 'hard')], 1, base, info)).toEqual({ w: 60, r: 9 });
    expect(setTarget([done('60', '9')], 1, base, info)).toEqual({ w: 60, r: 10 });
  });

  it('first set: ramp weight, else the suggestion, else empty', () => {
    expect(setTarget([], 0, base, info, 45)).toEqual({ w: 45, r: 8 });
    expect(setTarget([], 0, base, info)).toEqual({ w: 60, r: 10 });
    expect(setTarget([], 0, { mode: 'new', reps: 8, text: '', reason: '' }, info)).toEqual({ w: '', r: 8 });
  });

  it('ticking an empty set uses the placeholder', () => {
    expect(tickFill({ w: '', r: '' }, { w: 62.5, r: 10 }, info)).toEqual({ w: '62.5', r: '10', ok: true });
    expect(tickFill({ w: '', r: '' }, { w: '', r: 8 }, info)).toEqual({ w: '', r: '8', ok: false });
    expect(tickFill({ w: '', r: '' }, { w: '', r: 8 }, exInfo('Push-ups', catalog))).toEqual({ w: '', r: '8', ok: true });
  });
});

describe('find-your-weight ramp', () => {
  const info = exInfo('Hack Squat', catalog);
  const ramp = (...xs: [string, Rate?][]): SetEntry[] => xs.map(([w, rate]) => ({ w, r: '10', done: true, ...(rate ? { rate } : {}) }));

  it('Easy adds a ramp set; Just right is the weight; Hard one step lighter; Fail the previous weight', () => {
    expect(rampRate(ramp(['40']), 0, 'easy', info)).toEqual({ found: null, addSet: true });
    expect(rampRate(ramp(['40'], ['45']), 0, 'easy', info)).toEqual({ found: null, addSet: false });
    expect(rampRate(ramp(['40'], ['45']), 1, 'right', info)).toEqual({ found: 45, addSet: false });
    expect(rampRate(ramp(['40']), 0, 'hard', info).found).toBe(35);
    expect(rampRate(ramp(['40'], ['45']), 1, 'fail', info).found).toBe(40);
    expect(rampRate(ramp(['40']), 0, 'fail', info).found).toBe(35);
    expect(rampRate(ramp(['40']), 0, null, info)).toEqual({ found: null, addSet: false });
  });

  it('ticking fills the next weight after Easy and the reps', () => {
    const r = [...ramp(['40', 'easy']), { w: '', r: '', done: false }];
    expect(rampTickFill(r, 1, info)).toEqual({ w: '45', r: '8', ok: true });
    expect(rampTickFill([{ w: '', r: '', done: false }], 0, info)).toEqual({ w: '', r: '10', ok: false });
  });

  it('step helpers', () => {
    expect(snap(3.75, 2.5)).toBe(5);
    expect(snap(3.75, 0)).toBe(3.75);
    expect(harder(2.5, exInfo('Assisted Dips', catalog))).toBe(0);
    expect(easier(2.5, info, 0.1)).toBe(0);
    expect(kgLabel(12.5, exInfo('Hammer Curl', catalog))).toBe('12.5 kg each');
  });
});

describe('PINNED QUIRK tests', () => {
  // Spec question #102.
  it('PINNED QUIRK: a comma in a bodyweight +kg field becomes "NaN" in the next set', () => {
    const info = exInfo('Push-ups', catalog);
    const t = setTarget([{ w: '2,5', r: '10', done: true }], 1, { mode: 'bw', reps: 11, w: '', text: '', reason: '' }, info);
    expect(tickFill({ w: '', r: '' }, t, info)).toEqual({ w: 'NaN', r: '10', ok: true });
  });

  // Spec question #104.
  it('PINNED QUIRK: returning (55%) and deload (−10%) stack', () => {
    const c = ctx('Hack Squat', rec([[100, 10]]), { returning: { 'Hack Squat': { until: DATE } }, mods: { deload: true } });
    expect(applyMods(suggestBase({ name: 'Hack Squat' }, c), { name: 'Hack Squat' }, c).w).toBe(50);
  });

  // Spec question #103.
  it('PINNED QUIRK: an assisted bridge keeps the same assistance; an assisted return adds 45% of the suggestion, not of the old top', () => {
    const last = rec([[30, 10], [30, 10]]);
    const c = ctx('Assisted Pull-up', last);
    const s = suggestBase({ name: 'Assisted Pull-up' }, c); // up: 25 kg assist
    expect(applyMods(s, { name: 'Assisted Pull-up', bridge: true }, c)).toMatchObject({ w: 25, mode: 'hold' });
    const ret = ctx('Assisted Pull-up', last, { returning: { 'Assisted Pull-up': { until: DATE } } });
    expect(applyMods(s, { name: 'Assisted Pull-up' }, ret).w).toBe(35); // 25 + snap(11.25, 5)
  });

  // Spec question #104.
  it('PINNED QUIRK: the big-jump fallback says "kg" with no "each" or "assist"', () => {
    expect(sug('Assisted Pull-up', rec([[30, 10]])).reason).toContain('go back to 30 kg and add reps');
    expect(sug('Lateral Raise', rec([[5, 15]])).reason).toContain('go back to 5 kg and add reps');
  });

  // Spec question #104.
  it('PINNED QUIRK: bodyweight targets are not raised to the range bottom', () => {
    expect(sug('Push-ups', rec([[0, 3]]))).toMatchObject({ reps: 4, text: '4 reps a set' });
  });

  // Spec question #101.
  it('PINNED QUIRK: once today is logged, "two sessions running" no longer counts the older session', () => {
    const prev = { date: '2026-09-28', sets: [{ w: 60, r: 6 }] };
    expect(sug('Hack Squat', rec([[60, 6]], { prev }))).toMatchObject({ mode: 'down' });
    // Ticking a set today makes today the record and the last session its prev, which has no prev.
    expect(sug('Hack Squat', rec([[60, 6]], { date: DATE, prev: { date: '2026-10-01', sets: [{ w: 60, r: 6 }] } }))).toMatchObject({ mode: 'hold' });
  });
});

describe('weight guidance: differential against the prototype', () => {
  const proto = loadProgression(metaTable(catalog.meta));
  const r = rng(2020);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const names = [...Object.keys(catalog.meta), 'Mystery Lift'];
  const rates = [undefined, null, 'easy', 'right', 'hard', 'fail'] as const;
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const randSets = () =>
    Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
      const rate = pick(rates);
      return { w: pick([0, 2.5, 5, 10, 22.5, 25, 30, 50, 60, 80, 100]), r: Math.floor(r() * 22), ...(rate !== undefined ? { rate } : {}) };
    });

  function randState(name: string) {
    const date = pick(['2026-09-30', DATE, '2026-10-11', '2026-10-12']);
    const L: LiftRecord = { date: pick(['2026-10-01', DATE]), sets: randSets(), form: pick([undefined, null, 'yes', 'no'] as const) ?? null };
    const first = pick([undefined, '2026-08-01', '2026-09-28', '2026-10-01']);
    if (first) L.first = first;
    if (r() < 0.6) L.prev = { date: pick(['2026-09-20', '2026-10-01']), sets: randSets() };
    const ov: ExerciseOverride | undefined = pick([undefined, { lo: 6, hi: 8 }, { step: 1.25 }, { type: 'assisted' as const }, { type: 'bodyweight' as const, step: 0 }]);
    const where: Where = pick(['gym', 'dumbbells', 'bodyweight']);
    const c: ModsContext = {
      date,
      lifts: { [name]: L },
      catalog,
      overrides: ov ? { [name]: ov } : {},
      where,
      profile: { age: pick([30, 65]) },
      mods: { light: r() < 0.3, deload: r() < 0.3, reentry: pick([0, 0.15, 0.3]) },
      returning: r() < 0.3 ? { [name]: { until: pick(['2026-10-06', '2026-10-20']) } } : {},
    };
    Object.assign(proto.S, { date, lifts: clone(c.lifts), settings: { ex: clone(c.overrides), returning: clone(c.returning), profile: c.profile }, where, day: { workout: { exercises: [], mods: c.mods } } });
    return c;
  }

  it('suggestBase and applyMods match on 6,000 random states', () => {
    for (let k = 0; k < 6000; k++) {
      const name = pick(names);
      const c = randState(name);
      const ex = { name, ...(r() < 0.3 ? { bridge: true } : {}) };
      expect(suggestBase(ex, c)).toEqual(proto.suggestBase(ex));
      expect(applyMods(suggestBase(ex, c), ex, c)).toEqual(proto.suggestFor(ex));
    }
  });

  const entry = (): SetEntry => {
    const rate = pick(rates);
    return { w: pick(['', '0', '20', '22,5', '57.5']), r: pick(['', '0', '6', '12']), done: r() < 0.7, ...(rate ? { rate } : {}) };
  };

  it('setTarget and the tick fill match on 4,000 random sets', () => {
    for (let k = 0; k < 4000; k++) {
      const name = pick(names);
      const c = randState(name);
      const sets = Array.from({ length: 1 + Math.floor(r() * 4) }, entry);
      const j = Math.floor(r() * sets.length);
      (sets[j] as SetEntry).done = false;
      const found = pick([undefined, null, 40]);
      const ex = { name, sets: clone(sets), ...(found !== undefined ? { found } : {}) };
      const s = applyMods(suggestBase(ex, c), ex, c);
      const info = exInfo(name, catalog, c.overrides?.[name], c.where);
      const t = setTarget(sets, j, s, info, found);
      expect(t).toEqual(proto.setTarget(ex, j, proto.suggestFor(ex)));
      proto.S.day.workout.exercises = [ex];
      proto.workoutAction('tick', { dataset: { i: '0', j: String(j) } });
      const after = ex.sets[j] as SetEntry;
      expect(tickFill(sets[j] as SetEntry, t, info)).toEqual({ w: after.w, r: after.r, ok: after.done });
    }
  });

  it('ramp rating and ramp tick match on 4,000 random ramps', () => {
    for (let k = 0; k < 4000; k++) {
      const name = pick(names);
      const c = randState(name);
      const info = exInfo(name, catalog, c.overrides?.[name], c.where);
      const ramp = Array.from({ length: 1 + Math.floor(r() * 3) }, entry);
      const j = Math.floor(r() * ramp.length);
      const rate = pick(['easy', 'right', 'hard', 'fail', null] as const);
      const ex = { name, sets: [], ramp: clone(ramp), found: 99 };
      proto.S.day.workout.exercises = [ex];
      proto.workoutAction(rate ? 'rate' : 'rerate', { dataset: { i: '0', j: String(j), ramp: '1', ...(rate ? { v: rate } : {}) } });
      const { found, addSet } = rampRate(ramp, j, rate, info);
      expect({ found, len: ramp.length + (addSet ? 1 : 0) }).toEqual({ found: ex.found, len: ex.ramp.length });

      const tick = clone(ramp);
      (tick[j] as SetEntry).done = false;
      const ex2 = { name, sets: [], ramp: clone(tick) };
      proto.S.day.workout.exercises = [ex2];
      proto.workoutAction('ramp-tick', { dataset: { i: '0', j: String(j) } });
      const after = ex2.ramp[j] as SetEntry;
      expect(rampTickFill(tick, j, info)).toEqual({ w: after.w, r: after.r, ok: after.done });
    }
  });
});

describe('catalogue meta and custom exercises', () => {
  const tag = (equipment: string, more: Partial<ExerciseTag> = {}): ExerciseTag => ({ pattern: 'squat', family: 'custom', equipment, difficulty: 2, primary: ['quads'], secondary: [], joints: [], ...more });

  it('metaFor: the catalogue entry, else other 8–12', () => {
    expect(metaFor('Barbell Bench Press', catalog)).toEqual({ type: 'barbell', rep_low: 6, rep_high: 10 });
    expect(metaFor('Mystery', catalog)).toEqual({ type: 'other', rep_low: 8, rep_high: 12 });
    expect(metaFor('Mystery', { meta: {} })).toEqual({ type: 'other', rep_low: 8, rep_high: 12 });
  });

  it('customExerciseMeta: the five equipment types are kept, anything else is other; always 8–12', () => {
    for (const eq of ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight']) expect(customExerciseMeta(tag(eq))).toEqual({ type: eq, rep_low: 8, rep_high: 12 });
    for (const eq of ['kettlebell', 'band', 'other', 'assisted', 'time', '']) expect(customExerciseMeta(tag(eq))).toEqual({ type: 'other', rep_low: 8, rep_high: 12 });
  });

  it('applyCustomTags: adds tags and meta for new names, replaces tags but keeps meta for known names, leaves the input alone', () => {
    const before = JSON.stringify(catalog);
    const c = applyCustomTags(catalog, { 'Smith Squat': tag('machine'), 'Hack Squat': tag('barbell'), 'KB Swing': tag('kettlebell') });
    expect(JSON.stringify(catalog)).toBe(before);
    expect(c.meta['Smith Squat']).toEqual({ type: 'machine', rep_low: 8, rep_high: 12 });
    expect(c.meta['KB Swing']).toEqual({ type: 'other', rep_low: 8, rep_high: 12 });
    expect(c.tags['Hack Squat']).toEqual(tag('barbell'));
    expect(c.meta['Hack Squat']).toEqual(catalog.meta['Hack Squat']);
    // Known names keep their place; new ones follow the built-in tags (focusPick ties go by this order).
    expect(Object.keys(c.tags)).toEqual([...Object.keys(catalog.tags), 'Smith Squat', 'KB Swing']);
    expect(c.cards).toBe(catalog.cards);
    expect(c.away_map).toBe(catalog.away_map);
    expect(applyCustomTags(catalog, null)).toEqual(catalog);
    expect(applyCustomTags(catalog, undefined)).toEqual(catalog);
  });

  it('applyCustomTags: a custom exercise gets its guidance from its equipment', () => {
    const c = applyCustomTags(catalog, { 'Smith Squat': tag('machine'), 'Ring Row': tag('bodyweight'), 'KB Swing': tag('kettlebell') });
    expect(exInfo('Smith Squat', c)).toEqual({ type: 'machine', lo: 8, hi: 12, step: 5 });
    expect(exInfo('Ring Row', c)).toEqual({ type: 'bodyweight', lo: 8, hi: 12, step: 0 });
    expect(exInfo('KB Swing', c)).toEqual({ type: 'other', lo: 8, hi: 12, step: 2.5 });
    expect(suggestBase({ name: 'Smith Squat' }, { date: DATE, lifts: { 'Smith Squat': rec([[60, 12], [60, 12]]) }, catalog: c })).toMatchObject({ mode: 'up', w: 65 });
  });

  it('applyCustomTags matches the prototype on 2,000 random sets of custom tags', () => {
    const r = rng(106);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const known = Object.keys(catalog.tags);
    const eqs = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other', ''];
    for (let k = 0; k < 2000; k++) {
      const custom: Record<string, ExerciseTag> = {};
      for (let n = Math.floor(r() * 5); n > 0; n--) custom[r() < 0.3 ? pick(known) : `Custom ${Math.floor(r() * 6)}`] = tag(pick(eqs), { difficulty: 1 + Math.floor(r() * 3) });
      const proto = loadCustomTags(Object.fromEntries(Object.entries(catalog.tags).map(([n, t]) => [n, shortTag(t)])), metaTable(catalog.meta));
      proto.S.settings.customTags = Object.fromEntries(Object.entries(custom).map(([n, t]) => [n, shortTag(t)]));
      proto.applyCustomTags();
      const c = applyCustomTags(catalog, custom);
      expect(Object.keys(c.tags)).toEqual(Object.keys(proto.TAGS));
      expect(Object.fromEntries(Object.entries(c.tags).map(([n, t]) => [n, shortTag(t)]))).toEqual(proto.TAGS);
      expect(metaTable(c.meta)).toEqual(proto.EX_META);
    }
  });

  it('overridesFromSettings: contract names to the prototype’s, read by exInfo', () => {
    const ov = overridesFromSettings({ 'Hack Squat': { type: 'machine', step_kg: 2.5, rep_low: 6, rep_high: 8 }, 'Lateral Raise': { type: 'cable', step_kg: 0, rep_low: 15, rep_high: 20 } });
    expect(ov).toEqual({ 'Hack Squat': { type: 'machine', step: 2.5, lo: 6, hi: 8 }, 'Lateral Raise': { type: 'cable', step: 0, lo: 15, hi: 20 } });
    expect(exInfo('Hack Squat', catalog, ov['Hack Squat'])).toEqual({ type: 'machine', lo: 6, hi: 8, step: 2.5 });
    // A set low end turns off the home-dumbbell raise, as in the prototype.
    expect(exInfo('Lateral Raise', catalog, ov['Lateral Raise'], 'dumbbells')).toEqual({ type: 'cable', lo: 15, hi: 20, step: 0 });
    expect(suggestBase({ name: 'Hack Squat' }, { date: DATE, lifts: {}, catalog, overrides: ov })).toMatchObject({ mode: 'new', reps: 6, text: '6–8 reps' });
    expect(overridesFromSettings(null)).toEqual({});
    expect(overridesFromSettings(undefined)).toEqual({});
  });

  it('overridesFromSettings: an empty type falls back to the catalogue type, as prototype `o.type || m[0]` does', () => {
    const ov = overridesFromSettings({ 'Hack Squat': { type: '', step_kg: 1, rep_low: 6, rep_high: 8 } });
    expect(exInfo('Hack Squat', catalog, ov['Hack Squat'])).toEqual({ type: 'machine', lo: 6, hi: 8, step: 1 });
  });
});
