import { burnToday, cleanTarget, fitCarbs, macroKcal, macrosOff, workoutBurn, type BurnSet } from '../src/index';
import { loadProgress, type ProtoDay } from './prototype-progress';

const proto = loadProgress();
const PROFILE = { sex: 'male', age: 34, height: 178, weight: 82, activity: 'light', days: 3, minutes: 60, goal: 'maintain' };
const T0 = Date.parse('2026-10-05T10:00:00Z');

describe('editing targets (prototype renderTargets, fitcarbs)', () => {
  it.each([
    [{ kcal: 2200, protein_g: 150, fat_g: 70, carbs_g: 250 }],
    [{ kcal: 1500, protein_g: 200, fat_g: 80, carbs_g: 10 }],
    [{ kcal: 1000, protein_g: 200, fat_g: 100, carbs_g: 10 }], // would be negative: held at 0
    [{ kcal: 2501, protein_g: 151, fat_g: 66, carbs_g: 0 }], // rounds half up
  ])('fitCarbs matches the prototype fitcarbs for %j', (t) => {
    proto.S.settings.kcal = t.kcal;
    proto.S.settings.protein = t.protein_g;
    proto.S.settings.fat = t.fat_g;
    proto.S.settings.carbs = t.carbs_g;
    proto.fitcarbs();
    expect(fitCarbs(t)).toBe(proto.S.settings.carbs);
  });

  it('flags macros more than 50 kcal off the calories', () => {
    const t = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }; // 600 + 800 + 540 = 1940
    expect(macroKcal(t)).toBe(1940);
    expect(macrosOff(t)).toBe(true);
    expect(macrosOff({ ...t, kcal: 1990 })).toBe(false); // exactly 50 off is not flagged
  });

  it('cleans typed values: whole numbers, never below 0, junk is 0', () => {
    expect(cleanTarget('2150.6')).toBe(2151);
    expect(cleanTarget('180,4')).toBe(180);
    expect(cleanTarget('-5')).toBe(0);
    expect(cleanTarget('')).toBe(0);
    expect(cleanTarget('abc')).toBe(0);
  });
});

describe('burnToday (prototype burnToday)', () => {
  const profile = { sex: 'male' as const, age: 34, height_cm: 178, activity: 'light' as const };
  const sets: BurnSet[] = [0, 7, 15].map((m) => ({ kind: 'work', done: true, t: new Date(T0 + m * 60000).toISOString() }));
  it.each([
    ['no steps, nothing logged', undefined, [] as BurnSet[], 0, 0],
    ['steps and a workout with cardio', 8000, sets, 12, 1850],
    ['steps only', 4321, [] as BurnSet[], 0, 600],
  ])('%s', (_n, steps, ws, cardio, eaten) => {
    const exercises = [];
    const work = ws.map((s) => ({ done: s.done, t: Date.parse(s.t as string) }));
    for (let i = 0; i < work.length; i += 3) exercises.push({ sets: work.slice(i, i + 3) });
    const day: ProtoDay = {
      meals: eaten ? [{ name: 'x', qty: 1, kcal: eaten, p: 0, c: 0, f: 0 }] : [],
      workout: { exercises, cardio },
      ...(steps ? { steps } : {}),
    };
    proto.S.date = '2026-10-05';
    proto.S.day = day;
    proto.S.settings.profile = PROFILE;
    proto.S.weights.entries = { '2026-10-04': 80, '2026-10-06': 70 }; // the later weigh-in is after today: not used
    const want = proto.burnToday()!;
    const got = burnToday(profile, 80, steps, workoutBurn(ws, cardio, 80), eaten);
    expect(got.bmr).toBeCloseTo(want.bmr, 9);
    expect(got.move).toBeCloseTo(want.move, 9);
    expect(got.train).toBe(want.train);
    expect(got.dig).toBeCloseTo(want.dig, 9);
    expect(got.total).toBeCloseTo(want.total, 9);
    // The rounded step count the details block shows ("from N steps") comes back too.
    expect(got.steps).toBe(want.steps);
  });
  it('uses the activity level multiplier when no steps are logged (non-light differential)', () => {
    // No steps: the prototype falls back to bmr * ACTIVITY[p.activity].m. 'sitting' is 0.15, not light's 0.30,
    // so this pins the mapping, not just the value a constant 0.3 (light's own) would give.
    const sitting = { sex: 'male' as const, age: 34, height_cm: 178, activity: 'sitting' as const };
    const day: ProtoDay = { meals: [], workout: { exercises: [], cardio: 0 } };
    proto.S.date = '2026-10-05';
    proto.S.day = day;
    proto.S.settings.profile = { ...PROFILE, activity: 'sitting' };
    proto.S.weights.entries = { '2026-10-04': 80 };
    const want = proto.burnToday()!;
    const got = burnToday(sitting, 80, undefined, workoutBurn([], 0, 80), 0);
    expect(got.move).toBeCloseTo(want.move, 9);
    expect(got.total).toBeCloseTo(want.total, 9);
    expect(got.move).not.toBeCloseTo(got.bmr * 0.3, 9); // a fixed 0.3 (light) must not survive
  });
  it('rounds fractional steps from the steps box, as the prototype does', () => {
    // S.day.steps is text: the prototype does Math.round(num(S.day.steps)), so '8000.6' counts 8001 steps.
    const day: ProtoDay = { meals: [], workout: { exercises: [], cardio: 0 }, steps: '8000.6' };
    proto.S.date = '2026-10-05';
    proto.S.day = day;
    proto.S.settings.profile = PROFILE;
    proto.S.weights.entries = { '2026-10-04': 80 };
    const want = proto.burnToday()!;
    expect(want.steps).toBe(8001);
    const got = burnToday(profile, 80, '8000.6', workoutBurn([], 0, 80), 0);
    expect(got.move).toBeCloseTo(want.move, 9);
    expect(got.total).toBeCloseTo(want.total, 9);
    expect(got.steps).toBe(want.steps); // the rounded count the details block shows
    // The unrounded step count would give a different movement: the rounding must stay.
    expect(got.move).not.toBeCloseTo((8000.6 * 0.04 * 80) / 70, 9);
  });
  it('golden: 80 kg, light activity, 8,000 steps, nothing else = 1,747.5 resting + 365.7 movement', () => {
    const b = burnToday(profile, 80, 8000, workoutBurn([], 0, 80), 0);
    expect(b.bmr).toBe(1747.5);
    expect(b.move).toBeCloseTo(365.7142857, 6);
    expect(b.total).toBeCloseTo(2113.2142857, 6);
  });
});
