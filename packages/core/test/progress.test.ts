import { loadGolden } from './helpers';
import { rng } from './prototype-plan';
import { loadProgress, type ProtoDay } from './prototype-progress';
import {
  fibreTarget,
  latestWeight,
  measureAt,
  navyBodyFat,
  waterTarget,
  workoutBurn,
  stepsTarget,
  weightDrift,
  addDays,
  WATER_DEFAULT_ML,
  STEPS_DEFAULT,
  WEIGHT_DRIFT_KG,
  type BurnSet,
  type MeasurementFacts,
  type StepsDay,
  type WeighIn,
} from '../src';

interface Formulas {
  navyBodyFat: Record<string, number>;
  water: Record<string, number>;
  fibreTarget: Record<string, number>;
  workoutBurn: { sets: number; min: number; cardio: number; gross: number; extra: number; timed: boolean };
}

const golden = loadGolden<Formulas>('formulas');
const proto = loadProgress();
const r1 = (n: number): number => Math.round(n * 10) / 10;
const RUNS = 3000;
const DATE = '2026-10-07';
const T0 = Date.parse('2026-10-07T07:00:00Z');

/** Contract-shaped records to prototype `S` state. */
function setWeights(ws: readonly WeighIn[]): void {
  proto.S.weights.entries = Object.fromEntries(ws.filter((w) => !w.deleted_at).map((w) => [w.date, w.weight_kg]));
}
function setMeasures(ms: readonly MeasurementFacts[]): void {
  proto.S.measures.entries = Object.fromEntries(
    ms.filter((m) => !m.deleted_at).map((m) => [m.date, Object.fromEntries(Object.entries(m).filter(([k]) => k.endsWith('_cm')).map(([k, v]) => [k.slice(0, -3), v]))]),
  );
}
function protoWorkout(sets: readonly BurnSet[], cardio: number | null): ProtoDay['workout'] {
  // One exercise per 3 sets, as the prototype nests them; ramp and deleted sets are not in `ex.sets`.
  const work = sets.filter((s) => s.kind !== 'ramp' && !s.deleted_at).map((s) => ({ done: s.done, ...(s.t ? { t: Date.parse(s.t) } : {}) }));
  const exercises = [];
  for (let i = 0; i < work.length; i += 3) exercises.push({ sets: work.slice(i, i + 3) });
  return { exercises, cardio };
}

describe('golden formulas.json', () => {
  it('navy body fat, to 0.1', () => {
    const ms = (waist: number, neck: number, hips?: number): MeasurementFacts[] => [{ date: DATE, waist_cm: waist, neck_cm: neck, hips_cm: hips ?? null }];
    expect(r1(navyBodyFat({ sex: 'male', height_cm: 165 }, ms(95, 39), DATE) as number)).toBe(golden.navyBodyFat['male_165cm_w95_n39']);
    expect(r1(navyBodyFat({ sex: 'female', height_cm: 158 }, ms(78, 32, 98), DATE) as number)).toBe(golden.navyBodyFat['female_158cm_w78_n32_h98']);
  });
  it('water target at 82 kg', () => {
    const base = { date: DATE, weighIns: [{ date: DATE, weight_kg: 82 }], anySetDone: false, planned: null };
    expect(waterTarget(base)).toEqual({ ml: golden.water['kg82_restDay_ml'], trained: false });
    expect(waterTarget({ ...base, planned: 'Push A' })).toEqual({ ml: golden.water['kg82_trainingDay_ml'], trained: true });
  });
  it('fibre target at 2,000 kcal', () => {
    expect(fibreTarget(2000)).toBe(golden.fibreTarget['kcal2000']);
  });
  it('workout burn (inputs not in the fixture: 82 kg, 3 sets ticked over 15 min, 10 min cardio; #99)', () => {
    const sets: BurnSet[] = [0, 7, 15].map((m) => ({ kind: 'work', done: true, t: new Date(T0 + m * 60000).toISOString() }));
    expect(workoutBurn(sets, 10, 82)).toEqual(golden.workoutBurn);
    expect(proto.workoutBurn(protoWorkout(sets, 10), 82)).toEqual(golden.workoutBurn);
  });
});

describe('latestWeight and measureAt', () => {
  const ws: WeighIn[] = [
    { date: '2026-10-05', weight_kg: 80 },
    { date: '2026-10-07', weight_kg: 79.5 },
    { date: '2026-10-06', weight_kg: 79.8 },
    { date: '2026-10-08', weight_kg: 70, deleted_at: '2026-10-08T10:00:00Z' },
  ];
  it('takes the latest by date, up to a day, ignoring deleted weigh-ins', () => {
    expect(latestWeight(ws)).toBe(79.5);
    expect(latestWeight(ws, '2026-10-06')).toBe(79.8);
    expect(latestWeight(ws, '2026-10-04')).toBeNull();
    expect(latestWeight([])).toBeNull();
  });
  it('measureAt skips days without the part', () => {
    const ms: MeasurementFacts[] = [
      { date: '2026-10-01', waist_cm: 90, neck_cm: 38 },
      { date: '2026-10-03', waist_cm: 89, neck_cm: null },
      { date: '2026-10-05', waist_cm: 0 },
    ];
    expect(measureAt(ms, 'neck_cm', DATE)).toEqual({ date: '2026-10-01', v: 38 });
    expect(measureAt(ms, 'waist_cm', DATE)).toEqual({ date: '2026-10-03', v: 89 });
    expect(measureAt(ms, 'waist_cm', '2026-09-30')).toBeNull();
  });
});

describe('navyBodyFat', () => {
  const m: MeasurementFacts[] = [{ date: DATE, waist_cm: 95, neck_cm: 39, hips_cm: 100 }];
  it('is null with no profile, no height, a missing part or a non-positive log argument', () => {
    expect(navyBodyFat(null, m, DATE)).toBeNull();
    expect(navyBodyFat({ sex: 'male', height_cm: 0 }, m, DATE)).toBeNull();
    expect(navyBodyFat({ sex: 'male', height_cm: 170 }, [{ date: DATE, waist_cm: 95 }], DATE)).toBeNull();
    expect(navyBodyFat({ sex: 'male', height_cm: 170 }, [{ date: DATE, waist_cm: 39, neck_cm: 39 }], DATE)).toBeNull();
    expect(navyBodyFat({ sex: 'female', height_cm: 160 }, [{ date: DATE, waist_cm: 80, neck_cm: 33 }], DATE)).toBeNull();
  });
  it('is null outside 2–70 %', () => {
    expect(navyBodyFat({ sex: 'male', height_cm: 190 }, [{ date: DATE, waist_cm: 60, neck_cm: 45 }], DATE)).toBeNull();
    expect(navyBodyFat({ sex: 'female', height_cm: 150 }, [{ date: DATE, waist_cm: 200, neck_cm: 30, hips_cm: 200 }], DATE)).toBeNull();
  });
  it(`matches prototype navyBF over ${RUNS} random profiles and measurements`, () => {
    const r = rng(194);
    for (let i = 0; i < RUNS; i++) {
      const sex = r() < 0.5 ? 'male' : 'female';
      const height = r() < 0.03 ? 0 : 140 + Math.round(r() * 600) / 10;
      const ms: MeasurementFacts[] = [];
      for (let d = 0; d < 4; d++) {
        const pick = (lo: number, span: number): number | null => (r() < 0.3 ? null : lo + Math.round(r() * span * 10) / 10);
        ms.push({ date: addDays(DATE, -d * 3), waist_cm: pick(55, 90), neck_cm: pick(28, 25), hips_cm: pick(80, 60), deleted_at: r() < 0.1 ? 'x' : null });
      }
      const upTo = addDays(DATE, -Math.floor(r() * 8));
      proto.S.settings.profile = { sex, height };
      setMeasures(ms);
      expect(navyBodyFat({ sex, height_cm: height }, ms, upTo)).toBe(proto.navyBF(upTo));
    }
  });
});

describe('waterTarget', () => {
  it('falls back to the profile weight, then 2,500 ml', () => {
    expect(waterTarget({ date: DATE, weighIns: [{ date: '2026-10-08', weight_kg: 90 }], profileWeightKg: 60, anySetDone: false, planned: null })).toEqual({ ml: 2000, trained: false });
    expect(waterTarget({ date: DATE, weighIns: [], profileWeightKg: null, anySetDone: true, planned: null })).toEqual({ ml: WATER_DEFAULT_ML + 600, trained: true });
  });
  it(`matches prototype waterTarget over ${RUNS} random days`, () => {
    const r = rng(33);
    for (let i = 0; i < RUNS; i++) {
      const ws: WeighIn[] = r() < 0.3 ? [] : [{ date: addDays(DATE, Math.floor(r() * 5) - 3), weight_kg: 45 + Math.round(r() * 800) / 10 }];
      const profileWeightKg = r() < 0.3 ? null : 45 + Math.round(r() * 80);
      const anySetDone = r() < 0.4, planned = r() < 0.5 ? 'Push A' : null;
      setWeights(ws);
      proto.S.date = DATE;
      proto.S.settings.profile = profileWeightKg === null ? null : { weight: profileWeightKg };
      proto.S.day = { meals: [], workout: { exercises: [{ sets: [{ done: anySetDone }, { done: false }] }] } };
      proto.setPlanned(planned);
      const p = proto.waterTarget(); // its `trained` is the truthy value itself (null or the template); the port returns a boolean
      expect(waterTarget({ date: DATE, weighIns: ws, profileWeightKg, anySetDone, planned })).toEqual({ ml: p.ml, trained: !!p.trained });
    }
  });
});

describe('workoutBurn', () => {
  it('nothing done burns nothing', () => {
    expect(workoutBurn([{ done: false }], null, 80)).toEqual({ sets: 0, min: 0, cardio: 0, gross: 0, extra: 0, timed: false });
  });
  it('3 minutes a set with fewer than 2 tick times; ramp and deleted sets do not count', () => {
    const sets: BurnSet[] = [
      { done: true, t: null },
      { done: true, t: new Date(T0).toISOString() },
      { kind: 'ramp', done: true, t: new Date(T0 + 600000).toISOString() },
      { done: true, t: new Date(T0 + 900000).toISOString(), deleted_at: 'x' },
    ];
    expect(workoutBurn(sets, 0, 80)).toMatchObject({ sets: 2, min: 6, timed: false });
  });
  it('caps a long gap at 6 minutes a set (at least 10)', () => {
    const sets: BurnSet[] = [0, 120].map((m) => ({ done: true, t: new Date(T0 + m * 60000).toISOString() }));
    expect(workoutBurn(sets, 0, 80)).toMatchObject({ sets: 2, min: 12, timed: true });
    expect(workoutBurn(sets.slice(0, 1), 0, 80).min).toBe(3);
  });
  it(`matches prototype workoutBurn over ${RUNS} random workouts`, () => {
    const r = rng(5);
    for (let i = 0; i < RUNS; i++) {
      const n = Math.floor(r() * 16), sets: BurnSet[] = [];
      for (let j = 0; j < n; j++) {
        const t = r() < 0.2 ? null : new Date(T0 + Math.floor(r() * 7200000)).toISOString();
        sets.push({ kind: r() < 0.1 ? 'ramp' : 'work', done: r() < 0.8, t, deleted_at: r() < 0.05 ? 'x' : null });
      }
      const cardio = r() < 0.4 ? null : Math.floor(r() * 60), kg = 45 + Math.round(r() * 800) / 10;
      expect(workoutBurn(sets, cardio, kg)).toEqual(proto.workoutBurn(protoWorkout(sets, cardio), kg));
    }
  });
});

describe('stepsTarget', () => {
  const day = (back: number, steps: number | null): StepsDay => ({ date: addDays(DATE, -back), steps });
  it('7,000 with fewer than 3 days of steps in the 7 days before', () => {
    expect(stepsTarget([day(1, 9000), day(2, 9000), day(0, 9000), day(8, 9000), day(3, 0)], DATE)).toBe(STEPS_DEFAULT);
  });
  it('average + 1,000, to 500, within 5,000–12,000', () => {
    expect(stepsTarget([day(1, 6200), day(4, 6300), day(7, 6400)], DATE)).toBe(7500);
    expect(stepsTarget([day(1, 1000), day(2, 1000), day(3, 1000)], DATE)).toBe(5000);
    expect(stepsTarget([day(1, 20000), day(2, 20000), day(3, 20000)], DATE)).toBe(12000);
  });
  it(`matches prototype stepsTarget over ${RUNS / 10} random weeks`, async () => {
    const r = rng(1000);
    for (let i = 0; i < RUNS / 10; i++) {
      const days: StepsDay[] = [];
      for (let b = 0; b <= 9; b++) if (r() < 0.7) days.push({ ...day(b, r() < 0.2 ? null : Math.floor(r() * 18000)), deleted_at: r() < 0.05 ? 'x' : null });
      proto.S.date = DATE;
      proto.S.day = { meals: [], workout: { exercises: [] }, steps: 0 };
      for (const k of Object.keys(proto.stored)) delete proto.stored[k];
      for (const d of days) if (!d.deleted_at) proto.stored[d.date] = { meals: [], workout: { exercises: [] }, steps: d.steps };
      (proto.S as unknown as { dayCache: object }).dayCache = {};
      expect(stepsTarget(days, DATE)).toBe(await proto.stepsTarget());
    }
  });
});

describe('weightDrift (#161)', () => {
  const ws = (kg: number, date = DATE): WeighIn[] => [{ date: '2026-09-01', weight_kg: 90 }, { date, weight_kg: kg }];
  it('offers recalculation at 2 kg or more either way', () => {
    expect(weightDrift(ws(78), 80)).toEqual({ latest: 78, diff: 2, lower: true });
    expect(weightDrift(ws(82.5), 80)).toEqual({ latest: 82.5, diff: 2.5, lower: false });
    expect(weightDrift(ws(81.9), 80)).toBeNull();
    expect(weightDrift([], 80)).toBeNull();
    expect(WEIGHT_DRIFT_KG).toBe(2);
  });
  it('reads the latest weigh-in of any date', () => {
    expect(weightDrift(ws(70, '2027-01-01'), 80)).toMatchObject({ latest: 70 });
  });
  it('PINNED QUIRK (#209): a 2.0 kg gap that is 1.99999… in floating point offers nothing', () => {
    expect(64.1 - 62.1).toBeLessThan(2);
    expect(weightDrift(ws(64.1), 62.1)).toBeNull();
    setWeights(ws(64.1));
    proto.S.settings.profile = { sex: 'male', age: 30, height: 175, weight: 62.1, activity: 'light', days: 3, minutes: 60, goal: 'lose', pace: 'moderate' };
    expect(proto.setupSummaryHtml()).not.toContain('su-recalc');
  });
  it(`matches prototype setupSummaryHtml's note and startSetup's weight over ${RUNS} random weigh-ins`, () => {
    const r = rng(161);
    for (let i = 0; i < RUNS; i++) {
      const weight = 50 + Math.round(r() * 600) / 10;
      const list: WeighIn[] = r() < 0.15 ? [] : [{ date: addDays(DATE, -Math.floor(r() * 30)), weight_kg: Math.round((weight + (r() - 0.5) * 8) * 10) / 10 }];
      if (r() < 0.5) list.push({ date: addDays(DATE, -40), weight_kg: 100 });
      setWeights(list);
      proto.S.settings.profile = { sex: 'female', age: 40, height: 160, weight, activity: 'feet', days: 4, minutes: 45, goal: 'maintain', pace: 'moderate' };
      const d = weightDrift(list, weight), html = proto.setupSummaryHtml();
      expect(html.includes('su-recalc')).toBe(d !== null);
      if (d) expect(html).toContain(`Your latest weight is ${r1(d.latest)} kg, ${r1(d.diff)} kg ${d.lower ? 'lower' : 'higher'} than at setup.`);
      proto.startSetup();
      expect(proto.SU.p['weight']).toBe(latestWeight(list) ?? weight);
    }
  });
});
