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
  weeklyAvg,
  rapidLoss,
  addKcal,
  weightSlope,
  adaptiveBurn,
  nextAdaptive,
  targetFromBurn,
  weeklyCheckin,
  habits,
  toTargetsProfile,
  mondayOf,
  stalledList,
  KCAL_PER_KG,
  RAPID_LOSS_KCAL,
  CARDIO_WEEK_MIN,
  type AdaptiveState,
  type BurnProfile,
  type LiftRecord,
  type ProgressDay,
  type WeekPlan,
  type FoodLogFacts,
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
  it('compares the gap rounded to 0.1 kg, so a 2.0 kg gap that is 1.99999… in floating point counts (#209)', () => {
    expect(64.1 - 62.1).toBeLessThan(2);
    // Hand-worked: |64.1 − 62.1| = 1.999999999999993, × 10 = 19.99999999999993, rounds to 20, / 10 = 2.0 ≥ 2.
    expect(weightDrift(ws(64.1), 62.1)).toEqual({ latest: 64.1, diff: 64.1 - 62.1, lower: false });
    expect(weightDrift(ws(62.1), 64.1)).toMatchObject({ latest: 62.1, lower: true });
    for (const [lw, w] of [[64.6, 62.6], [65.1, 63.1], [128.2, 126.2]] as const) expect(weightDrift(ws(lw), w)).not.toBeNull();
    // 1.95 rounds to 2.0 (shown as 2 kg), 1.94 to 1.9.
    expect(weightDrift(ws(81.95), 80)).not.toBeNull();
    expect(weightDrift(ws(81.94), 80)).toBeNull();
    setWeights(ws(64.1));
    proto.S.settings.profile = { sex: 'male', age: 30, height: 175, weight: 62.1, activity: 'light', days: 3, minutes: 60, goal: 'lose', pace: 'moderate' };
    expect(proto.setupSummaryHtml()).toContain('su-recalc');
    expect(proto.setupSummaryHtml()).toContain('Your latest weight is 64.1 kg, 2 kg higher than at setup.');
  });
  it(`matches prototype setupSummaryHtml's note and startSetup's weight over ${RUNS} random weigh-ins`, () => {
    const r = rng(161);
    let roundedIn = 0;
    for (let i = 0; i < RUNS; i++) {
      const weight = 50 + Math.round(r() * 600) / 10;
      const off = r() < 0.25 ? (r() < 0.5 ? -2 : 2) : (r() - 0.5) * 8; // a quarter exactly 2 kg off, many 1.99999… in floating point
      const list: WeighIn[] = r() < 0.15 ? [] : [{ date: addDays(DATE, -Math.floor(r() * 30)), weight_kg: Math.round((weight + off) * 10) / 10 }];
      if (r() < 0.5) list.push({ date: addDays(DATE, -40), weight_kg: 100 });
      setWeights(list);
      proto.S.settings.profile = { sex: 'female', age: 40, height: 160, weight, activity: 'feet', days: 4, minutes: 45, goal: 'maintain', pace: 'moderate' };
      const d = weightDrift(list, weight), html = proto.setupSummaryHtml();
      expect(html.includes('su-recalc')).toBe(d !== null);
      if (d) expect(html).toContain(`Your latest weight is ${r1(d.latest)} kg, ${r1(d.diff)} kg ${d.lower ? 'lower' : 'higher'} than at setup.`);
      if (d && d.diff < WEIGHT_DRIFT_KG) roundedIn++;
      proto.startSetup();
      expect(proto.SU.p['weight']).toBe(latestWeight(list) ?? weight);
    }
    expect(roundedIn).toBeGreaterThan(0); // gaps like 64.1 vs 62.1 that only count after rounding (#209)
  });
});

/* ---------- real burn, rapid loss, habits, weekly check-in ---------- */

type R = () => number;
const pickOf = <T>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

function randomProfile(r: R): BurnProfile {
  const sex = r() < 0.5 ? 'male' : 'female', days = Math.floor(r() * 7);
  return {
    sex,
    age: 18 + Math.floor(r() * 70),
    height_cm: 150 + Math.floor(r() * 45),
    weight_kg: 50 + Math.round(r() * 700) / 10,
    activity: pickOf(r, ['sitting', 'light', 'feet', 'physical'] as const),
    days,
    minutes: days ? pickOf(r, [30, 45, 60, 75, 90]) : null,
    goal: pickOf(r, ['lose', 'recomp', 'maintain', 'gain'] as const),
    pace: pickOf(r, ['gentle', 'moderate'] as const),
    special: sex === 'female' && r() < 0.1 ? 'pregnant' : 'none',
  };
}

/** Random days ending on DATE (contract facts), most with food; some with a tick, steps, sleep, cardio, a done set. */
function randomDays(r: R, n: number, dense = false): ProgressDay[] {
  const out: ProgressDay[] = [], fill = dense ? 0.95 : 0.4 + r() * 0.6;
  for (let b = 0; b < n; b++) {
    if (r() > fill) continue;
    const logs = Array.from({ length: (dense ? 1 : 0) + Math.floor(r() * 6) }, (_, j) => ({ name: `f${j}`, qty: pickOf(r, [0.5, 1, 1, 1.5, 2]), kcal: 100 + Math.floor(r() * 600), protein_g: Math.round(r() * 400) / 10, carbs_g: 20, fat_g: 5 }));
    const c = r();
    out.push({
      date: addDays(DATE, -b),
      logs,
      complete: c < (dense ? 0.9 : 0.4) ? true : c < (dense ? 0.93 : 0.5) ? false : null,
      steps: r() < 0.5 ? null : Math.floor(r() * 15000),
      sleep: r() < 0.5 ? null : Math.round(r() * 100) / 10,
      cardioMin: r() < 0.6 ? null : Math.floor(r() * 60),
      trained: r() < 0.5,
    });
  }
  return out;
}
function randomWeighIns(r: R, n: number, dense = false): WeighIn[] {
  const out: WeighIn[] = [], p = dense ? 0.5 + r() * 0.5 : r(), trend = (r() - 0.6) * 0.15;
  for (let b = n - 1; b >= 0; b--) if (r() < p) out.push({ date: addDays(DATE, -b), weight_kg: Math.round((80 - trend * b + (r() - 0.5)) * 10) / 10 });
  return out;
}
function randomLifts(r: R): Record<string, LiftRecord> {
  const lifts: Record<string, LiftRecord> = {};
  for (let k = 0; k < Math.floor(r() * 5); k++) {
    const hist = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, j) => ({ date: addDays(DATE, -30 + j * 4), e: 50 + Math.floor(r() * 40) }));
    lifts[`Lift ${k}`] = { date: hist[hist.length - 1]!.date, sets: [], hist };
  }
  return lifts;
}

function toProtoDay(d: ProgressDay): ProtoDay {
  return {
    meals: d.logs.map((m: FoodLogFacts) => ({ name: m.name, qty: m.qty, kcal: m.kcal, p: m.protein_g, c: m.carbs_g, f: m.fat_g })),
    workout: { exercises: [{ sets: [{ done: d.trained }] }], cardio: d.cardioMin },
    steps: d.steps,
    sleep: d.sleep,
    ...(d.complete == null ? {} : { complete: d.complete }),
  };
}
function setDays(days: readonly ProgressDay[]): void {
  for (const k of Object.keys(proto.stored)) delete proto.stored[k];
  for (const d of days) proto.stored[d.date] = toProtoDay(d);
  (proto.S as unknown as { dayCache: object }).dayCache = {};
  proto.S.date = DATE;
  const today = days.find((d) => d.date === DATE);
  proto.S.day = today ? toProtoDay(today) : { meals: [], workout: { exercises: [] } };
}
function setProfile(p: BurnProfile | null): void {
  proto.S.settings.profile = p ? (toTargetsProfile(p) as unknown as Record<string, unknown>) : null;
}

describe('weeklyAvg and rapidLoss', () => {
  const daily = (kgs: number[], end = DATE): WeighIn[] => kgs.map((kg, b) => ({ date: addDays(end, -b), weight_kg: kg }));
  it('averages 3 or more weigh-ins in the 7 days ending on a day', () => {
    expect(weeklyAvg(daily([80, 81]), DATE)).toBeNull();
    expect(weeklyAvg(daily([80, 81, 82]), DATE)).toBe(81);
    expect(weeklyAvg(daily([80, 81, 82], addDays(DATE, -7)), DATE)).toBeNull();
  });
  it('fast for 2 weeks, or 1 week with 2 stalls', () => {
    const two = daily([...Array(7).fill(78), ...Array(7).fill(79), ...Array(7).fill(80)]);
    expect(rapidLoss(two, DATE, 0)).toEqual({ key: 'kcal:' + mondayOf(DATE), drop: 1, twoWeeks: true, stalls: 0 });
    const one = daily([...Array(7).fill(78), ...Array(7).fill(79), ...Array(7).fill(79)]);
    expect(rapidLoss(one, DATE, 1)).toBeNull();
    expect(rapidLoss(one, DATE, 2)).toMatchObject({ twoWeeks: false, stalls: 2 });
    expect(rapidLoss([], DATE, 5)).toBeNull();
  });
  it('the second week is measured against 1% of the week before it (w2), not of last week (w0)', () => {
    // w2 − w0 = 0.995: under 1% of w2 (1.0) but over 1% of w0 (0.99005), so only a w0 threshold would call it fast.
    const ws = daily([...Array(7).fill(97), ...Array(7).fill(99.005), ...Array(7).fill(100)]);
    expect(weeklyAvg(ws, addDays(DATE, -7))).toBe(99.005);
    expect(rapidLoss(ws, DATE, 0)).toBeNull();
    expect(rapidLoss(ws, DATE, 2)).toMatchObject({ twoWeeks: false, stalls: 2 });
    setWeights(ws);
    proto.S.lifts = {};
    proto.S.settings.adj = {};
    proto.setToday(DATE);
    expect(proto.calorieCard()).toBe('');
  });
  it('addKcal keeps calories at 1,200 or more and carbs at 0 or more', () => {
    expect(addKcal({ kcal: 1900, carbs: 190 }, RAPID_LOSS_KCAL)).toEqual({ kcal: 2050, carbs: 228 });
    expect(addKcal({ kcal: 1250, carbs: 10 }, -150)).toEqual({ kcal: 1200, carbs: 0 });
    for (const [kcal, carbs, v] of [[1900, 190, 150], [1250, 10, -150], [1300, 50, -1000]] as const) {
      proto.S.settings.kcal = kcal;
      proto.S.settings.carbs = carbs;
      proto.adjKcal(String(v));
      expect(addKcal({ kcal, carbs }, v)).toEqual({ kcal: proto.S.settings.kcal, carbs: proto.S.settings.carbs });
    }
  });
  it(`matches prototype weeklyAvg and calorieCard over ${RUNS} random weigh-ins`, () => {
    const r = rng(150);
    for (let i = 0; i < RUNS; i++) {
      const ws = randomWeighIns(r, 24), lifts = randomLifts(r);
      setWeights(ws);
      proto.S.lifts = JSON.parse(JSON.stringify(lifts));
      proto.S.date = DATE;
      proto.S.settings.adj = {};
      proto.setToday(DATE);
      expect(weeklyAvg(ws, DATE)).toBe(proto.weeklyAvg(DATE));
      const got = rapidLoss(ws, DATE, stalledListCount(lifts)), html = proto.calorieCard();
      expect(html !== '').toBe(got !== null);
      if (got) expect(html).toContain(`fell about ${r1(got.drop)} kg${got.twoWeeks ? ', faster than 1%' : `, and ${got.stalls} lifts have stalled`}`);
    }
  });
});

const stalledListCount = (lifts: Record<string, LiftRecord>): number => stalledList(lifts, DATE).length;

describe('weightSlope, adaptiveBurn, targetFromBurn', () => {
  it('slope needs 6 weigh-ins in the span; 0.1 kg a day down is -0.1', () => {
    const ws = Array.from({ length: 6 }, (_, b) => ({ date: addDays(DATE, -b * 3), weight_kg: 80 + b * 0.3 }));
    expect(weightSlope(ws.slice(0, 5), DATE, 21)).toEqual({ n: 5 });
    expect(weightSlope(ws, DATE, 21).slope).toBeCloseTo(-0.1, 12);
    expect(weightSlope(ws, DATE, 14)).toEqual({ n: 5 });
  });
  it('needs 10 complete days in 14 and 6 weigh-ins in 21', () => {
    expect(adaptiveBurn([], [], DATE, 2000, null)).toEqual({ ready: false, needDays: 10, needW: 6 });
  });
  it('burn = intake − slope × 7,700, smoothed 60/40 with last week', () => {
    const days: ProgressDay[] = Array.from({ length: 10 }, (_, b) => ({ date: addDays(DATE, -b), logs: [{ name: 'x', qty: 1, kcal: 2000, protein_g: 0, carbs_g: 0, fat_g: 0 }], complete: true, trained: false }));
    const ws = Array.from({ length: 7 }, (_, b) => ({ date: addDays(DATE, -b * 3), weight_kg: 80 + b * 0.3 }));
    const fresh = adaptiveBurn(days, ws, DATE, 2000, null);
    expect(fresh).toMatchObject({ ready: true, intake: 2000, logged: 10, burn: Math.round(2000 + 0.1 * KCAL_PER_KG) });
    expect(adaptiveBurn(days, ws, DATE, 2000, { week: mondayOf(DATE), prev: 2500, value: 9999 })).toMatchObject({ burn: Math.round(0.6 * 2500 + 0.4 * 2770) });
    expect(adaptiveBurn(days, ws, DATE, 2000, { week: '2026-01-05', prev: 9999, value: 2500 })).toMatchObject({ burn: Math.round(0.6 * 2500 + 0.4 * 2770) });
  });
  it('nextAdaptive moves last week\'s value to prev on a new week', () => {
    expect(nextAdaptive(null, DATE, 2400)).toEqual({ week: mondayOf(DATE), prev: null, value: 2400 });
    expect(nextAdaptive({ week: '2026-09-28', prev: 1, value: 2300 }, DATE, 2400)).toEqual({ week: mondayOf(DATE), prev: 2300, value: 2400 });
    expect(nextAdaptive({ week: mondayOf(DATE), prev: 2200, value: 2300 }, DATE, 2400)).toEqual({ week: mondayOf(DATE), prev: 2200, value: 2400 });
  });
  it('targetFromBurn is null with no profile', () => {
    expect(targetFromBurn(2500, null, [], 150)).toBeNull();
  });
  it(`matches prototype weightSlope, adaptiveBurn and targetFromBurn over ${RUNS / 3} random histories`, async () => {
    const r = rng(7700);
    for (let i = 0; i < RUNS / 3; i++) {
      const dense = r() < 0.5, days = randomDays(r, 22, dense), ws = randomWeighIns(r, 24, dense), kcal = 1500 + Math.floor(r() * 130) * 10, protein = 100 + Math.floor(r() * 80);
      const AD: AdaptiveState | null = r() < 0.3 ? null : { week: r() < 0.5 ? mondayOf(DATE) : '2026-09-28', prev: r() < 0.3 ? null : 2000 + Math.floor(r() * 1000), value: r() < 0.2 ? null : 2000 + Math.floor(r() * 1000) };
      const profile = randomProfile(r);
      setDays(days);
      setWeights(ws);
      setProfile(profile);
      Object.assign(proto.S.settings, { kcal, protein, adaptive: AD ? { ...AD } : undefined });
      expect(weightSlope(ws, DATE, 21)).toEqual(proto.weightSlope(DATE, 21));
      expect(adaptiveBurn(days, ws, DATE, kcal, AD)).toEqual(proto.adaptiveBurn(await proto.loadDays(DATE, 21)));
      const burn = 1200 + Math.floor(r() * 2500);
      expect(targetFromBurn(burn, profile, ws, protein)).toEqual(proto.targetFromBurn(burn));
    }
  });
});

describe('weeklyCheckin', () => {
  const base = { date: DATE, days: [] as ProgressDay[], weighIns: [] as WeighIn[], lifts: {}, kcal: 2000, protein: 150, profile: null };
  it('an empty week: no averages, the shorter-week suggestion', () => {
    const c = weeklyCheckin(base);
    expect(c).toMatchObject({ key: 'ci:' + mondayOf(DATE), sessions: 0, plannedN: 6, logged: 0, avgK: 0, avgP: 0, w1: null, w0: null, cardioMin: 0, steps: null, sleep: null, formula: null, suggestion: { kind: 'week' } });
    expect(CARDIO_WEEK_MIN).toBe(150);
    expect(weeklyCheckin({ ...base, muted: { checkin: true } }).suggestion).toBeNull();
    expect(weeklyCheckin({ ...base, dismissed: { [c.key]: true } }).suggestion).toBeNull();
  });
  it('this week\'s plan sets the planned count', () => {
    const weekPlan: WeekPlan = { start: mondayOf(DATE), list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] };
    expect(weeklyCheckin({ ...base, weekPlan })).toMatchObject({ plannedN: 4, suggestion: null });
  });
  const profileOf = (days: number): BurnProfile => ({ sex: 'male', age: 30, height_cm: 175, weight_kg: 80, activity: 'light', days, minutes: 60, goal: 'maintain', pace: 'moderate', special: 'none' });
  const trainedOn = (...back: number[]): ProgressDay[] => back.map((b) => ({ date: addDays(DATE, -b), logs: [], trained: true }));
  it('with no week plan the planned count is the profile\'s plan length (#215)', () => {
    // Hand-worked: 3 days → 3 planned; 3 of 3 done, 3 + 2 > 3, so no shorter-week card.
    expect(weeklyCheckin({ ...base, days: trainedOn(1, 3, 5), profile: profileOf(3) })).toMatchObject({ sessions: 3, plannedN: 3, suggestion: null });
    // 6 days, 4 done: 4 + 2 ≤ 6 → card. 5 days, 3 done: 3 + 2 ≤ 5 → card; 4 done: no card.
    expect(weeklyCheckin({ ...base, days: trainedOn(0, 1, 2, 3), profile: profileOf(6) })).toMatchObject({ plannedN: 6, suggestion: { kind: 'week' } });
    expect(weeklyCheckin({ ...base, days: trainedOn(0, 2, 4), profile: profileOf(5) })).toMatchObject({ plannedN: 5, suggestion: { kind: 'week' } });
    expect(weeklyCheckin({ ...base, days: trainedOn(0, 1, 2, 4), profile: profileOf(5) })).toMatchObject({ plannedN: 5, suggestion: null });
    // 4 days or fewer: never offered "a 4-day plan". 4 days, 2 done (2 + 2 ≤ 4) and 3 days, 0 done (0 + 2 ≤ 3): no card.
    expect(weeklyCheckin({ ...base, days: trainedOn(0, 2), profile: profileOf(4) })).toMatchObject({ sessions: 2, plannedN: 4, suggestion: null });
    expect(weeklyCheckin({ ...base, profile: profileOf(3) })).toMatchObject({ sessions: 0, plannedN: 3, suggestion: null });
    expect(weeklyCheckin({ ...base, profile: profileOf(2) })).toMatchObject({ sessions: 0, plannedN: 2, suggestion: null });
    // 5 days, 0 done: the smallest count that still gets the card.
    expect(weeklyCheckin({ ...base, profile: profileOf(5) })).toMatchObject({ plannedN: 5, suggestion: { kind: 'week' } });
    // 0 days (no plan): 0 planned, never the card. No profile: the 6-day plan.
    expect(weeklyCheckin({ ...base, profile: profileOf(0) })).toMatchObject({ sessions: 0, plannedN: 0, suggestion: null });
    expect(weeklyCheckin({ ...base, profile: null })).toMatchObject({ plannedN: 6, suggestion: { kind: 'week' } });
  });
  it('only a current or future week plan stops the shorter-week suggestion (#215)', () => {
    const list = ['Upper A', 'Lower A', 'Upper B', 'Lower B'];
    // Past plan: ignored for the count and the card.
    expect(weeklyCheckin({ ...base, weekPlan: { start: '2026-08-03', list } })).toMatchObject({ plannedN: 6, sessions: 0, suggestion: { kind: 'week' } });
    expect(weeklyCheckin({ ...base, weekPlan: { start: addDays(mondayOf(DATE), -7), list } })).toMatchObject({ plannedN: 6, suggestion: { kind: 'week' } });
    // Next week's plan (what "Use a 4-day plan next week" saves): this week still counts 6, but no card.
    expect(weeklyCheckin({ ...base, weekPlan: { start: addDays(mondayOf(DATE), 7), list } })).toMatchObject({ plannedN: 6, suggestion: null });
    // This week's plan: counts 4; 0 + 2 ≤ 4 but the plan blocks the card.
    expect(weeklyCheckin({ ...base, weekPlan: { start: mondayOf(DATE), list } })).toMatchObject({ plannedN: 4, suggestion: null });
  });
  it('sleep under 7 hours is short; exactly 7 is not (#264)', () => {
    const slept = (...h: number[]): ProgressDay[] => h.map((v, b) => ({ date: addDays(DATE, -b), logs: [], sleep: v, trained: false }));
    expect(weeklyCheckin({ ...base, days: slept(7, 7) })).toMatchObject({ sleep: 7, sleepShort: false });
    expect(weeklyCheckin({ ...base, days: slept(7, 6.8) })).toMatchObject({ sleep: 6.9, sleepShort: true });
    // 0 hours is "not entered", so no average and nothing short.
    expect(weeklyCheckin({ ...base, days: slept(0) })).toMatchObject({ sleep: null, sleepShort: false });
    expect(weeklyCheckin(base)).toMatchObject({ sleep: null, sleepShort: false });
  });
  it('week-on-week weight change needs both weekly averages; no change counts as down (#264)', () => {
    const weighed = (thisWeek: number, lastWeek: number): WeighIn[] => [0, 1, 2].flatMap((b) => [{ date: addDays(DATE, -b), weight_kg: thisWeek }, { date: addDays(DATE, -7 - b), weight_kg: lastWeek }]);
    expect(weeklyCheckin({ ...base, weighIns: weighed(80, 81) }).weeklyChange).toEqual({ amount: 1, down: true });
    expect(weeklyCheckin({ ...base, weighIns: weighed(80.5, 80) }).weeklyChange).toEqual({ amount: 0.5, down: false });
    expect(weeklyCheckin({ ...base, weighIns: weighed(80, 80) }).weeklyChange).toEqual({ amount: 0, down: true });
    // Only 2 weigh-ins last week: no average, no change.
    expect(weeklyCheckin({ ...base, weighIns: weighed(80, 81).slice(0, 5) })).toMatchObject({ w0: null, weeklyChange: null });
  });
  it('slope per week is the real-burn slope × 7, null until the burn is ready (#264)', () => {
    expect(weeklyCheckin(base)).toMatchObject({ burn: { ready: false }, slopePerWeek: null });
    // Ready: 10 complete days with food and 10 daily weigh-ins moving 0.1 kg a day, so 0.7 kg a week.
    const eaten: ProgressDay[] = Array.from({ length: 10 }, (_, b) => ({ date: addDays(DATE, -b), logs: [{ name: 'dal', qty: 1, kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }], complete: true, trained: false }));
    const trend = (perDay: number): WeighIn[] => Array.from({ length: 10 }, (_, b) => ({ date: addDays(DATE, -b), weight_kg: 80 - perDay * b }));
    const down = weeklyCheckin({ ...base, days: eaten, weighIns: trend(-0.1) }), up = weeklyCheckin({ ...base, days: eaten, weighIns: trend(0.1) });
    expect(down.burn.ready && up.burn.ready).toBe(true);
    expect(down.slopePerWeek).toBeCloseTo(-0.7, 10);
    expect(up.slopePerWeek).toBeCloseTo(0.7, 10);
    expect(down.slopePerWeek).toBe(down.burn.ready ? down.burn.slope * 7 : NaN);
  });
  it(`matches prototype renderCheckin over ${RUNS / 3} random weeks`, async () => {
    const r = rng(2026);
    const reached = { pastPlanCard: 0, futurePlanBlocks: 0, profilePlanned: 0, smallPlanSkips: 0, sleepShort: 0, sleepOk: 0, weightDown: 0, weightUp: 0, slopeDown: 0, slopeUp: 0 };
    for (let i = 0; i < RUNS / 3; i++) {
      const dense = r() < 0.5, days = randomDays(r, 22, dense), ws = randomWeighIns(r, 24, dense), lifts = randomLifts(r), kcal = 1500 + Math.floor(r() * 130) * 10, protein = 100 + Math.floor(r() * 80);
      const profile = r() < 0.15 ? null : randomProfile(r);
      const adaptive: AdaptiveState | null = r() < 0.5 ? null : { week: '2026-09-28', prev: null, value: 2000 + Math.floor(r() * 1000) };
      const weekPlan: WeekPlan | null = r() < 0.7 ? null : { start: pickOf(r, [mondayOf(DATE), mondayOf(DATE), addDays(mondayOf(DATE), 7), addDays(mondayOf(DATE), -7), '2026-08-03']), list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'].slice(0, 2 + Math.floor(r() * 3)) };
      const key = 'ci:' + mondayOf(DATE), dismissed = r() < 0.1 ? { [key]: true } : {}, muted = r() < 0.1 ? { checkin: true } : {};
      setDays(days);
      setWeights(ws);
      setProfile(profile);
      proto.S.lifts = JSON.parse(JSON.stringify(lifts));
      Object.assign(proto.S.settings, { kcal, protein, adaptive: adaptive ? { ...adaptive } : undefined, adj: { dismissed: { ...dismissed }, muted: { ...muted }, declines: {}, ...(weekPlan ? { weekPlan } : {}) } });
      proto.setToday(DATE);
      proto.S.tab = 'progress'; // startSetup (drift tests) leaves it on 'setup', and renderCheckin then returns early
      const c = weeklyCheckin({ date: DATE, days, weighIns: ws, lifts, kcal, protein, profile, adaptive, weekPlan, dismissed, muted });
      const html = await proto.renderCheckin(), ci = proto.S.ciData as Record<string, unknown>;
      expect({ sessions: c.sessions, plannedN: c.plannedN, logged: c.logged, avgK: c.avgK, avgP: c.avgP, pDays: c.pDays, w1: c.w1, w0: c.w0, improved: c.improved, stalled: c.stalled, burn: c.burn.ready ? c.burn.burn : null }).toEqual({
        sessions: ci['sessions'], plannedN: ci['plannedN'], logged: ci['logged'], avgK: ci['avgK'], avgP: ci['avgP'], pDays: ci['pDays'], w1: ci['w1'], w0: ci['w0'], improved: ci['improved'], stalled: ci['stalled'], burn: ci['burn'],
      });
      expect(html).toContain(`Cardio: ${Math.round(c.cardioMin).toLocaleString('en-IN')} of ${CARDIO_WEEK_MIN} min this week`);
      expect(html.includes(`Steps: about ${Math.round(c.steps ?? 0).toLocaleString('en-IN')} a day.`)).toBe(c.steps !== null);
      expect(html.includes(`Sleep: ${r1(c.sleep ?? 0)} hours a night`)).toBe(c.sleep !== null);
      expect(html.includes('under the 7–9 hours that best supports fat loss and recovery')).toBe(c.sleepShort);
      const L = (n: number): string => r1(n).toLocaleString('en-IN'), ch = c.weeklyChange, sl = c.slopePerWeek;
      expect(html.includes('Weight: log at least 3 weigh-ins a week')).toBe(ch === null);
      if (ch) expect(html).toContain(`Weight: weekly average ${L(c.w1 ?? 0)} kg, ${ch.down ? 'down' : 'up'} ${L(ch.amount)} kg from last week.`);
      expect(sl !== null).toBe(c.burn.ready);
      if (sl !== null) expect(html).toContain(`your weight trend (${sl <= 0 ? 'down' : 'up'} ${L(Math.abs(sl))} kg a week)`);
      if (c.sleep !== null) reached[c.sleepShort ? 'sleepShort' : 'sleepOk']++;
      if (ch) reached[ch.down ? 'weightDown' : 'weightUp']++;
      if (sl !== null) reached[sl <= 0 ? 'slopeDown' : 'slopeUp']++;
      if (c.burn.ready && c.formula !== null) expect(html).toContain(`compared with ${Math.round(c.formula).toLocaleString('en-IN')} from the setup formula`);
      const kind = html.includes('data-act="ci-apply"') ? 'kcal' : html.includes('data-act="ci-week"') ? 'week' : html.includes('Protein was the gap') ? 'protein' : null;
      expect(c.suggestion?.kind ?? null).toBe(kind);
      if (c.suggestion?.kind === 'kcal') expect(html).toContain(`data-v="${JSON.stringify(c.suggestion.target).replace(/"/g, '&quot;')}"`);
      if (c.burn.ready) expect(nextAdaptive(adaptive, DATE, c.burn.burn)).toEqual(proto.S.settings.adaptive);
      if (weekPlan && weekPlan.start < mondayOf(DATE) && c.suggestion?.kind === 'week') reached.pastPlanCard++;
      if (weekPlan && weekPlan.start > mondayOf(DATE) && c.plannedN > 4 && c.sessions + 2 <= c.plannedN && !dismissed[key] && !muted.checkin && c.suggestion?.kind !== 'kcal') reached.futurePlanBlocks++;
      if (profile && !weekPlan && c.plannedN !== 6) reached.profilePlanned++;
      if (c.plannedN <= 4 && c.sessions + 2 <= c.plannedN && !(weekPlan && weekPlan.start >= mondayOf(DATE)) && !dismissed[key] && !muted.checkin && c.suggestion?.kind !== 'kcal') reached.smallPlanSkips++;
    }
    for (const n of Object.values(reached)) expect(n).toBeGreaterThan(0);
  });
});

describe('habits', () => {
  const profile = { days: 4 };
  type Sessions = Record<string, { t: string; n: number }>;
  it('on-track weeks need plan days − 1 sessions (at least 2), counted back from last week', () => {
    const monday = mondayOf(DATE), sessions: Sessions = {};
    for (const k of [1, 2]) for (const d of [0, 1, 3]) sessions[addDays(monday, -7 * k + d)] = { t: 'Upper A', n: 10 };
    sessions[addDays(monday, -21)] = { t: 'Upper A', n: 10 };
    sessions[monday] = { t: 'Upper A', n: 10 };
    expect(habits(DATE, sessions, profile, [])).toEqual({ goal: 3, weeks: 2, thisWeek: 1, logged: 0, message: 'streak' });
    expect(habits(DATE, {}, { days: 2 }, [])).toMatchObject({ goal: 2, weeks: 0, message: 'missed' });
    expect(habits(DATE, {}, { days: 0 }, [])).toMatchObject({ goal: 2 });
  });
  it(`matches prototype consistencyHtml over ${RUNS / 3} random histories`, async () => {
    const r = rng(66);
    for (let i = 0; i < RUNS / 3; i++) {
      const sessions: Sessions = {}, density = r();
      for (let b = 0; b < 200; b++) if (r() < density) sessions[addDays(DATE, -b)] = { t: 'Push A', n: 5 };
      const p = r() < 0.1 ? null : { days: Math.floor(r() * 7) }, days = randomDays(r, 9);
      setDays(days);
      proto.S.sessions.entries = sessions;
      proto.S.settings.profile = p;
      const h = habits(DATE, sessions, p, days), html = await proto.consistencyHtml();
      expect(html).toContain(`<b>${h.thisWeek}</b><span>sessions this week (aim ${h.goal}+)</span>`);
      expect(html).toContain(`<b>${h.logged}/7</b>`);
      expect(html).toContain(`<b>${h.weeks}</b><span>on-track weeks in a row</span>`);
      const msg = html.includes('weeks in a row with') ? 'streak' : html.includes('Missed a few days') ? 'missed' : 'steady';
      expect(h.message).toBe(msg);
    }
  });
});
