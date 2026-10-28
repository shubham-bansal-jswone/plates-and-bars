import {
  checkinFlags,
  exInfo,
  kgLabel,
  nextInList,
  planList,
  REST_COMPOUND_SEC,
  REST_EXTEND_SEC,
  REST_OTHER_SEC,
  restFor,
  restLabel,
  warmupRamp,
  warmupSets,
  WARMUP_RAMP_HEAVY,
  WARMUP_RAMP_HEAVY_KG,
  WARMUP_RAMP_LIGHT,
  type Checkin,
  type CheckinReason,
  type ExerciseOverride,
  type ExType,
  type PlanProfile,
  type Where,
} from '../src/index';
import { goldenCatalog, metaTable, rng, shortTag } from './prototype-plan';
import { prototypeSource, sliceBlock, sliceTrimmedLine } from './helpers';
import { loadWorkout } from './prototype-workout';

// No golden fixture covers these rules; they are checked against the prototype's own functions
// (differential tests below) and by hand-worked unit tests.
const catalog = goldenCatalog();
const tags = catalog.tags;
const proto = loadWorkout(Object.fromEntries(Object.entries(tags).map(([n, t]) => [n, shortTag(t)])), metaTable(catalog.meta));
const NAMES = [...Object.keys(tags), 'Mystery Lift', 'constructor', 'toString', ''];
const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

describe('restFor and restLabel', () => {
  it('150 s for a compound pattern, 75 s otherwise (untagged names too)', () => {
    expect(restFor('Barbell Back Squat', tags)).toBe(REST_COMPOUND_SEC);
    expect(restFor('Lateral Raise', tags)).toBe(REST_OTHER_SEC);
    expect(restFor('Mystery Lift', tags)).toBe(75);
    expect(restFor('constructor', tags)).toBe(75);
    expect(restLabel('Barbell Back Squat', tags)).toBe('2–3 min');
    expect(restLabel('Lateral Raise', tags)).toBe('60–90 sec');
  });
  it('matches prototype restFor/restLabel for every catalogue name', () => {
    for (const n of NAMES) {
      expect(restFor(n, tags)).toBe(proto.restFor(n));
      expect(restLabel(n, tags)).toBe(proto.restLabel(n));
    }
  });
});

describe('REST_EXTEND_SEC', () => {
  it('matches the prototype rest-add button (milliseconds on the end, seconds on the total)', () => {
    const m = prototypeSource().match(/a === 'rest-add'\)\{ REST\.end \+= (\d+); REST\.total \+= (\d+);/);
    if (!m) throw new Error('prototype: rest-add changed shape');
    expect(Number(m[1])).toBe(REST_EXTEND_SEC * 1000);
    expect(Number(m[2])).toBe(REST_EXTEND_SEC);
  });
});

describe('nextInList', () => {
  it('next template, wrapping; unknown name gives the first; no plan gives null', () => {
    const p: PlanProfile = { days: 3 };
    const L = planList(p);
    expect(nextInList(L[0] as string, p)).toBe(L[1]);
    expect(nextInList(L[L.length - 1] as string, p)).toBe(L[0]);
    expect(nextInList('Nope', p)).toBe(L[0]);
    expect(nextInList('Push A', { days: 0 })).toBeNull();
  });
  it('matches prototype nextInList over every split and template', () => {
    const profiles: (PlanProfile | null)[] = [null, {}, { days: null }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((days) => ({ days }))];
    const ts = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B', 'Full A', 'Full B', 'Upper A', 'Lower A', 'Nope', ''];
    for (const p of profiles) {
      proto.S.settings.profile = clone(p);
      for (const t of ts) expect(nextInList(t, p)).toBe(proto.nextInList(t));
    }
  });
});

describe('warmupSets', () => {
  const squat = 'Barbell Back Squat';
  const info = exInfo(squat, catalog);
  const ex = { name: squat, sets: [{ done: false }] };
  it('8 reps at 50%, 4 at 75%, snapped to the step', () => {
    expect(warmupSets(ex, 0, { w: 100 }, [ex], info, tags)).toEqual([
      { w: 50, reps: 8 },
      { w: 75, reps: 4 },
    ]);
    expect(warmupSets(ex, 0, { w: 61 }, [ex], info, tags)).toEqual([
      { w: 30, reps: 8 },
      { w: 45, reps: 4 },
    ]);
    expect(warmupSets(ex, 0, { w: 61 }, [ex], { ...info, step: 0 }, tags)).toEqual([
      { w: 30, reps: 8 },
      { w: 45, reps: 4 },
    ]); // step 0 snaps to 2.5
  });
  it('none: not the first compound, a set ticked, no weight, isolation, bodyweight or assisted', () => {
    const lat = { name: 'Lateral Raise', sets: [] };
    expect(warmupSets(ex, 1, { w: 100 }, [ex, ex], info, tags)).toBeNull();
    expect(warmupSets(ex, 1, { w: 100 }, [lat, ex], info, tags)).not.toBeNull();
    expect(warmupSets({ name: squat, sets: [{ done: true }] }, 0, { w: 100 }, [ex], info, tags)).toBeNull();
    expect(warmupSets(ex, 0, { w: '' }, [ex], info, tags)).toBeNull();
    expect(warmupSets(ex, 0, {}, [ex], info, tags)).toBeNull();
    expect(warmupSets(ex, 0, { w: 0 }, [ex], info, tags)).toBeNull();
    expect(warmupSets(lat, 0, { w: 10 }, [lat], exInfo('Lateral Raise', catalog), tags)).toBeNull();
    expect(warmupSets(ex, 0, { w: 100 }, [ex], { ...info, type: 'bodyweight' }, tags)).toBeNull();
    expect(warmupSets(ex, 0, { w: 100 }, [ex], { ...info, type: 'assisted' }, tags)).toBeNull();
  });

  it('matches prototype warmupHtml over 5,000 random sessions', () => {
    const r = rng(138);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const TYPES: ExType[] = ['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight', 'time', 'other'];
    const WHERE: Where[] = ['gym', 'dumbbells', 'bodyweight'];
    let shown = 0;
    for (let k = 0; k < 5000; k++) {
      const n = 1 + Math.floor(r() * 6);
      const exercises = Array.from({ length: n }, () => ({ name: pick(NAMES), sets: Array.from({ length: Math.floor(r() * 4) }, () => ({ done: r() < 0.15 })) }));
      // half the time aim at the first compound (the only index that can show a warm-up)
      const first = exercises.findIndex((e) => restFor(e.name, tags) === REST_COMPOUND_SEC);
      const i = r() < 0.5 && first >= 0 ? first : Math.floor(r() * (n + 1)) - (r() < 0.05 ? 1 : 0);
      const target = exercises[Math.max(0, Math.min(n - 1, i))] as (typeof exercises)[number];
      const w = pick<number | '' | undefined>([0, -5, '', undefined, Math.round(r() * 2000) / 10, Math.round(r() * 200), Math.round(r() * 80) / 4]);
      const o: ExerciseOverride | undefined =
        r() < 0.3 ? { ...(r() < 0.5 ? { type: pick(TYPES) } : {}), ...(r() < 0.6 ? { step: pick([0, 1, 1.25, 2, 2.5, 5, 7]) } : {}) } : undefined;
      const where = pick(WHERE);
      const info = exInfo(target.name, catalog, o, where);
      Object.assign(proto.S, { settings: { ex: o ? { [target.name]: clone(o) } : {} }, where, day: { workout: { exercises: clone(exercises) } } });
      expect(info).toEqual(proto.exInfo(target.name));
      const sug = w === undefined ? {} : { w };
      const ours = warmupSets(target, i, sug, exercises, info, tags);
      const html = proto.warmupHtml(clone(target), i, clone(sug));
      if (ours) shown++;
      expect(html).toBe(ours ? `<p class="hint warm"><b>Warm up first:</b> ${ours[0].reps} reps at ${kgLabel(ours[0].w, info)}, then ${ours[1].reps} at ${kgLabel(ours[1].w, info)}. Not logged. </p>` : '');
    }
    expect(shown).toBeGreaterThan(500); // the grid reaches the shown branch often enough to matter
  });
});

describe('warmupRamp', () => {
  const squat = 'Barbell Back Squat';
  const bench = 'Barbell Bench Press';
  const incline = 'Incline Dumbbell Press';
  const info = exInfo(squat, catalog);
  const ex = { name: squat, sets: [{ done: false }] };
  const ramp = (w: number | '' | undefined, i = ex, inf: typeof info = info) => warmupRamp(i, 0, w === undefined ? {} : { w }, [i], inf, tags);

  it('named constants', () => {
    expect(WARMUP_RAMP_HEAVY_KG).toBe(60);
    expect(WARMUP_RAMP_LIGHT).toEqual([{ pct: 0.5, reps: 8 }, { pct: 0.75, reps: 4 }]);
    expect(WARMUP_RAMP_HEAVY).toEqual([{ pct: 0.4, reps: 8 }, { pct: 0.6, reps: 5 }, { pct: 0.8, reps: 3 }]);
  });
  it('light first compound is the prototype pair', () => {
    expect(ramp(40)).toEqual([{ w: 20, reps: 8 }, { w: 30, reps: 4 }]);
    expect(ramp(59.9)).toEqual(warmupSets(ex, 0, { w: 59.9 }, [ex], info, tags));
  });
  it('heavy first compound has three steps, from exactly 60 kg', () => {
    expect(ramp(100)).toEqual([{ w: 40, reps: 8 }, { w: 60, reps: 5 }, { w: 80, reps: 3 }]);
    expect(ramp(60)).toEqual([{ w: 25, reps: 8 }, { w: 35, reps: 5 }, { w: 47.5, reps: 3 }]);
  });
  it('snaps to the exercise step; step 0 is 2.5', () => {
    expect(ramp(100, ex, { ...info, step: 5 })).toEqual([{ w: 40, reps: 8 }, { w: 60, reps: 5 }, { w: 80, reps: 3 }]);
    expect(ramp(62, ex, { ...info, step: 5 })).toEqual([{ w: 25, reps: 8 }, { w: 35, reps: 5 }, { w: 50, reps: 3 }]);
    expect(ramp(61, ex, { ...info, step: 0 })).toEqual(ramp(61, ex, { ...info, step: 2.5 }));
  });
  it('drops steps that collapse to 0, repeat the previous step or reach w', () => {
    expect(ramp(3, ex, { ...info, step: 5 })).toBeNull(); // 1.5 and 2.25 snap to 0
    expect(ramp(5, ex, { ...info, step: 5 })).toBeNull(); // 2.5 -> 5 and 3.75 -> 5 both reach w
    expect(ramp(6, ex, { ...info, step: 5 })).toEqual([{ w: 5, reps: 8 }]); // 3 -> 5, then 4.5 -> 5 repeats
    expect(ramp(65, ex, { ...info, step: 20 })).toEqual([{ w: 20, reps: 8 }, { w: 40, reps: 5 }, { w: 60, reps: 3 }]);
  });
  it('a step at or above w is dropped', () => {
    expect(ramp(2, ex, { ...info, step: 2.5 })).toBeNull(); // 1 -> 0, 1.5 -> 2.5 (>= 2)
    expect(ramp(10, ex, { ...info, step: 5 })).toEqual([{ w: 5, reps: 8 }]); // 7.5 -> 10 equals w
  });
  it('null for no weight, bodyweight, assisted, isolation, ticked set', () => {
    for (const w of [0, -5, '', undefined] as const) expect(ramp(w)).toBeNull();
    expect(ramp(100, ex, { ...info, type: 'bodyweight' })).toBeNull();
    expect(ramp(100, ex, { ...info, type: 'assisted' })).toBeNull();
    const lat = { name: 'Lateral Raise', sets: [] };
    expect(ramp(10, lat, exInfo('Lateral Raise', catalog))).toBeNull();
    expect(ramp(100, { name: squat, sets: [{ done: true }] })).toBeNull();
  });
  it('differential: for every catalogue compound below 60 kg, equals warmupSets with steps that reach the work weight dropped', () => {
    let compared = 0;
    for (const name of Object.keys(tags).filter((n) => restFor(n, tags) === REST_COMPOUND_SEC)) {
      const e = { name, sets: [] };
      const inf = exInfo(name, catalog);
      for (const w of [10, 20, 25, 30, 40, 45, 50, 57.5, 59.5]) {
        const old = warmupSets(e, 0, { w }, [e], inf, tags);
        const cur = warmupRamp(e, 0, { w }, [e], inf, tags);
        if (!old) {
          expect(cur).toBeNull();
          continue;
        }
        // the ramp is warmupSets with the drop rules applied (0, repeat of previous, >= w)
        const kept = old.filter((st, k) => st.w > 0 && st.w < w && (k === 0 || st.w !== old[k - 1]?.w));
        expect(cur).toEqual(kept.length ? kept : null);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });
  it('later compounds: bench after squat gets a ramp; incline after bench none', () => {
    const sq = { name: squat, sets: [] };
    const be = { name: bench, sets: [] };
    const inc = { name: incline, sets: [] };
    expect(warmupRamp(be, 1, { w: 80 }, [sq, be], exInfo(bench, catalog), tags)).toEqual([{ w: 32.5, reps: 8 }, { w: 47.5, reps: 5 }, { w: 65, reps: 3 }]);
    expect(warmupRamp(inc, 1, { w: 30 }, [be, inc], exInfo(incline, catalog), tags)).toBeNull();
    expect(warmupRamp(inc, 2, { w: 30 }, [sq, be, inc], exInfo(incline, catalog), tags)).toBeNull();
    expect(warmupRamp(be, 0, { w: 80 }, [be, inc], exInfo(bench, catalog), tags)).not.toBeNull();
    // earlier isolation work does not warm a muscle for a later compound
    const fly = Object.keys(tags).find((n) => restFor(n, tags) !== REST_COMPOUND_SEC && tags[n]?.primary.includes('chest')) as string;
    const lat = { name: 'Lateral Raise', sets: [] };
    expect(warmupRamp(be, 1, { w: 80 }, [{ name: fly, sets: [] }, be], exInfo(bench, catalog), tags)).not.toBeNull(); // still the first compound
    expect(warmupRamp(be, 2, { w: 80 }, [{ name: fly, sets: [] }, sq, be], exInfo(bench, catalog), tags)).not.toBeNull(); // earlier isolation work does not count
    expect(warmupRamp(be, 2, { w: 80 }, [sq, { name: fly, sets: [] }, be], exInfo(bench, catalog), tags)).toEqual([{ w: 32.5, reps: 8 }, { w: 47.5, reps: 5 }, { w: 65, reps: 3 }]);
    expect(warmupRamp(be, 1, { w: 80 }, [lat, be], exInfo(bench, catalog), tags)).not.toBeNull(); // first compound is index 1
    expect(warmupRamp(be, 2, { w: 80 }, [sq, lat, be], exInfo(bench, catalog), tags)).not.toBeNull();
    expect(warmupRamp(be, -1, { w: 80 }, [sq, be], exInfo(bench, catalog), tags)).toBeNull();
    expect(warmupRamp(be, 1, { w: 80 }, [{ name: 'Mystery Lift', sets: [] }, be], exInfo(bench, catalog), tags)).not.toBeNull();
  });
});

describe('checkinFlags', () => {
  it('flags poor sleep, low energy, very sore; offers a swap only when very sore', () => {
    expect(checkinFlags({ sleep: 'poor', energy: 'low', sore: 'very' }, 'Pull A')).toEqual({ flagged: true, reasons: ['sleep', 'energy', 'sore'], swapTo: 'Pull A', good: false });
    expect(checkinFlags({ sleep: 'poor' }, 'Pull A')).toEqual({ flagged: true, reasons: ['sleep'], swapTo: null, good: false });
    expect(checkinFlags({ sore: 'very' }, null)).toEqual({ flagged: true, reasons: ['sore'], swapTo: null, good: false });
    expect(checkinFlags({ sleep: 'ok', energy: 'good', sore: 'some' }, 'Pull A')).toEqual({ flagged: false, reasons: [], swapTo: null, good: true });
    expect(checkinFlags({ sleep: 'ok', energy: 'good' }, 'Pull A').good).toBe(false);
    expect(checkinFlags(null, null)).toEqual({ flagged: false, reasons: [], swapTo: null, good: false });
  });

  it('matches the prototype check-in for every answer combination', () => {
    const WORD: Record<CheckinReason, string> = { sleep: 'poor sleep', energy: 'low energy', sore: 'very sore muscles' };
    const opt = <T>(xs: T[]): (T | undefined | null)[] => [undefined, null, ...xs];
    for (const sleep of opt<Checkin['sleep']>(['good', 'ok', 'poor']))
      for (const sore of opt<Checkin['sore']>(['none', 'some', 'very']))
        for (const energy of opt<Checkin['energy']>(['good', 'ok', 'low']))
          for (const time of opt<Checkin['time']>(['usual', '45', '30']))
            for (const nextT of [null, 'Pull A']) {
              const ci = { sleep, sore, energy, time } as Checkin;
              const ours = checkinFlags(ci, nextT);
              const p = proto.checkin(ci, nextT);
              expect(ours.flagged).toBe(p.flagged);
              expect(ours.flagged ? ours.reasons.map((x) => WORD[x]).join(' and ') : null).toBe(p.why);
              expect(ours.swapTo).toBe(p.swap);
              expect(ours.good).toBe(p.good);
            }
  });
});

// #139 (decided: hide it, as the app does): after "I know my weight" the find-your-weight guide does not come back. The app
// shows the guide only while `sug.mode === 'new' && !working && !ex.skipRamp` (ExerciseCard); this runs the prototype's own
// `exerciseCard` and its `ramp-skip` action, with the card's other helpers stubbed.
describe('find-your-weight guide after "I know my weight" (#139)', () => {
  const src = prototypeSource();
  type Ex = { name: string; sets: { w: string; r: string; done: boolean }[]; ramp?: unknown; skipRamp?: boolean; found?: number | null };
  const run = new Function(
    'sug',
    [
      'const info = { type:"machine", lo:8, hi:12, step:2.5 };',
      'const exInfo = () => info, suggestFor = () => sug, lastFor = () => null, noLoad = () => false, esc = x => String(x ?? "");',
      'const sampleFn = null, SAMPLE_IMG = null, TYPE_LABEL = { machine:"Machine" }, restLabel = () => "", whyLink = () => "", ladderMeta = () => "";',
      'const r1 = x => x, repWord = () => "reps", exMusclesLine = () => "", learnHtml = () => "", estimateFor = () => null, kgLabel = w => w + " kg";',
      'const harder = w => w, rampMsg = () => "", rateRow = () => "", warmupHtml = () => "", stallCard = () => "", ladderCard = () => "";',
      'const setTarget = () => ({ w:"", r:"" }), feelHtml = () => "", saveDay = () => {}, render = () => {};',
      sliceBlock(src, 'function exerciseCard(ex, i){', '}'),
      'function act(a, ex){ switch(a){',
      sliceTrimmedLine(src, "case 'ramp-skip': "),
      '} }',
      'return { exerciseCard, act };',
    ].join('\n'),
  ) as (sug: { mode: string; reason: string }) => { exerciseCard(ex: Ex, i: number): string; act(a: string, ex: Ex): void };
  const fresh = (): Ex => ({ name: 'Leg Press', sets: [{ w: '', r: '', done: false }] });
  const GUIDE = 'First time: find your weight';

  it('a new exercise shows the guide until "I know my weight" is tapped, then never again', () => {
    const p = run({ mode: 'new', reason: '' });
    const ex = fresh();
    expect(p.exerciseCard(ex, 0)).toContain(GUIDE);
    expect(p.exerciseCard(ex, 0)).toContain('data-act="ramp-skip"');
    p.act('ramp-skip', ex);
    expect(ex).toMatchObject({ ramp: null, skipRamp: true, found: null });
    const html = p.exerciseCard(ex, 0);
    expect(html).not.toContain(GUIDE);
    expect(html).not.toContain('Ramp sets');
    expect(html).not.toContain('Suggested:'); // a new loaded exercise has no suggestion text, as in the app
    expect(html).toContain('data-act="tick"'); // the working sets stay
  });
  it('the guide still hides once a working set is ticked, and for a non-new exercise', () => {
    const p = run({ mode: 'new', reason: '' });
    expect(p.exerciseCard({ ...fresh(), sets: [{ w: '50', r: '10', done: true }] }, 0)).not.toContain(GUIDE);
    expect(run({ mode: 'up', reason: 'Top of the range' }).exerciseCard(fresh(), 0)).not.toContain(GUIDE);
  });
});
