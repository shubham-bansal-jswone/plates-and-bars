import {
  calcTargets,
  bmrOf,
  num,
  type Activity,
  type Goal,
  type Pace,
  type Sex,
  type Special,
  type TargetsProfile,
  type TargetsResult,
} from '../src/index';
import { loadGolden, prototypeSource, sliceBlock, sliceLine } from './helpers';

interface GoldenCase {
  input: TargetsProfile & { id: string };
  output: {
    tdee: number;
    bmr: number;
    movement: number;
    training: number;
    digestion: number;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    floored: boolean;
    capped: boolean;
    refWeight: number;
    weeklyKg: number;
  };
}

/**
 * Projects a full result onto the fixture's shape. The fixture stores energy values rounded to
 * whole kcal (as the prototype's `fmt` displays them) and weekly change to 2 decimals. The JSON
 * round trip mirrors how the fixture was written (it turns -0 into 0).
 */
function toGolden(r: TargetsResult): GoldenCase['output'] {
  const out = {
    tdee: Math.round(r.tdee),
    bmr: Math.round(r.bmr),
    movement: Math.round(r.movement),
    training: Math.round(r.training),
    digestion: Math.round(r.digestion),
    kcal: r.kcal,
    protein: r.protein,
    carbs: r.carbs,
    fat: r.fat,
    floored: r.floored,
    capped: r.capped,
    refWeight: Math.round(r.refW),
    weeklyKg: Math.round(r.weekly * 100) / 100,
  };
  return JSON.parse(JSON.stringify(out)) as GoldenCase['output'];
}

const golden = loadGolden<GoldenCase[]>('targets');

describe('calcTargets: golden/targets.json', () => {
  it('has cases to check', () => {
    expect(golden.length).toBe(8);
  });

  it.each(golden.map((c) => [c.input.id, c] as const))('%s', (_id, c) => {
    expect(toGolden(calcTargets(c.input))).toEqual(c.output);
  });
});

describe('calcTargets: differential against the prototype source', () => {
  // Runs the prototype's own num, ACTIVITY, PACE, TRAIN_NET_MET, bmrOf and calcTargets.
  const src = prototypeSource();
  // ACTIVITY .. latestWeight (tables and constants), then bmrOf, then calcTargets.
  const code = [
    sliceLine(src, 'const num = '),
    sliceBlock(src, 'const ACTIVITY = {', '}'),
    sliceLine(src, 'const bmrOf = '),
    sliceBlock(src, 'function calcTargets(p){', '}'),
    'return calcTargets;',
  ].join('\n');
  const protoCalc = new Function(code)() as (p: unknown) => Record<string, unknown>;

  const sexes: Sex[] = ['male', 'female'];
  const activities: Activity[] = ['sitting', 'light', 'feet', 'physical'];
  const goals: Goal[] = ['lose', 'recomp', 'maintain', 'gain'];
  const paces: (Pace | undefined)[] = ['gentle', 'moderate', undefined];
  const specials: (Special | undefined)[] = ['none', 'pregnant', 'breastfeeding', undefined];
  const bodies = [
    { age: 18, height: 140, weight: 37 },
    { age: 29, height: 140, weight: 37 },
    { age: 35, height: 165, weight: 82 },
    { age: 60, height: 155, weight: 62 },
    { age: 90, height: 150, weight: 45 },
    { age: 25, height: 190, weight: 140 },
    { age: 40, height: 170.2, weight: 101.3 },
  ];
  const training: [number | null, number | null][] = [
    [0, 0],
    [null, null],
    [2, 30],
    [4, 60],
    [7, 90],
  ];

  const cases: TargetsProfile[] = [];
  for (const sex of sexes)
    for (const activity of activities)
      for (const goal of goals)
        for (const pace of paces)
          for (const special of specials)
            for (const b of bodies)
              for (const [days, minutes] of training) {
                const p: TargetsProfile = { sex, activity, goal, days, minutes, ...b };
                if (pace !== undefined) p.pace = pace;
                if (special !== undefined) p.special = special;
                cases.push(p);
              }

  it(`matches the prototype exactly on ${cases.length} profiles`, () => {
    const mismatches = cases.filter((p) => {
      const ours = calcTargets(p) as unknown as Record<string, unknown>;
      const theirs = protoCalc(p);
      // `special` is compared by truthiness: the prototype yields `undefined` or `''` (falsy) when
      // `p.special` is absent; the port always returns a boolean. Every other field must be identical.
      const same = (k: string) => (k === 'special' ? !!ours[k] === !!theirs[k] : Object.is(ours[k], theirs[k]));
      return Object.keys(theirs).some((k) => !same(k)) || Object.keys(ours).length !== Object.keys(theirs).length;
    });
    expect(mismatches).toEqual([]);
  });

  it('covers capped, floored and special branches', () => {
    const rs = cases.map(calcTargets);
    expect(rs.some((r) => r.capped)).toBe(true);
    expect(rs.some((r) => r.floored)).toBe(true);
    expect(rs.some((r) => r.special)).toBe(true);
  });
});

describe('calcTargets: edge cases', () => {
  const base: TargetsProfile = {
    sex: 'male',
    age: 25,
    height: 190,
    weight: 120,
    activity: 'physical',
    days: 6,
    minutes: 90,
    goal: 'lose',
    pace: 'moderate',
    special: 'none',
  };

  it('caps the deficit at 750 kcal', () => {
    const r = calcTargets(base);
    expect(r.tdee).toBeCloseTo(4716.825, 3);
    expect(r.capped).toBe(true);
    expect(r.floored).toBe(false);
    expect(r.kcal).toBe(3970); // round((4716.83 - 750) / 10) * 10
  });

  it('uses the BMI-27 reference weight for protein when BMI > 30', () => {
    const r = calcTargets(base); // BMI 33.2
    expect(r.refW).toBe(97); // round(27 * 1.9^2) = round(97.47)
    expect(r.protein).toBe(195); // round(97 * 2.0 / 5) * 5 = round(38.8) * 5
  });

  it('defaults pace to moderate when absent', () => {
    const { pace: _omit, ...noPace } = base;
    expect(calcTargets(noPace).adj).toBe(-0.2);
    expect(calcTargets({ ...base, pace: 'gentle' }).adj).toBe(-0.15);
  });

  it('ignores pregnancy for men (setup resets it, but the rule is sex-gated too)', () => {
    const r = calcTargets({ ...base, special: 'pregnant' });
    expect(r.special).toBe(false);
    expect(r.adj).toBe(-0.2);
  });

  it('never sets a deficit for breastfeeding women and uses 1.8 g/kg protein', () => {
    const r = calcTargets({ ...base, sex: 'female', special: 'breastfeeding', goal: 'recomp' });
    expect(r.special).toBe(true);
    expect(r.adj).toBe(0);
    expect(r.perKg).toBe(1.8);
  });

  it('keeps a gain surplus for pregnant women', () => {
    expect(calcTargets({ ...base, sex: 'female', special: 'pregnant', goal: 'gain' }).adj).toBe(0.07);
  });

  it('treats null days and minutes as no training', () => {
    expect(calcTargets({ ...base, days: null, minutes: null }).training).toBe(0);
  });

  it('floors women at 1200 kcal when TDEE allows it', () => {
    const r = calcTargets({ ...base, sex: 'female', age: 50, height: 150, weight: 45, activity: 'sitting', days: 0, minutes: 0 });
    expect(r.floored).toBe(true);
    expect(r.kcal).toBe(1200);
  });

  it('floors at TDEE when TDEE is under the floor', () => {
    const r = calcTargets({ ...base, sex: 'female', age: 60, height: 140, weight: 35, activity: 'sitting', days: 0, minutes: 0 });
    expect(r.tdee).toBeLessThan(1195);
    expect(r.floored).toBe(true);
    expect(r.kcal).toBe(Math.round(r.tdee / 10) * 10);
  });

  // Prototype quirk, pinned on purpose: "never above TDEE" is applied before rounding to 10, so
  // a TDEE just under the floor can round up to a target above TDEE (and a positive weekly change).
  it('PINNED QUIRK: floored target can round above TDEE', () => {
    const r = calcTargets({ ...base, sex: 'female', age: 29, height: 140, weight: 37, activity: 'sitting', days: 0, minutes: 0 });
    expect(r.tdee).toBeCloseTo(1199.833, 3);
    expect(r.floored).toBe(true);
    expect(r.kcal).toBe(1200);
    expect(r.kcal).toBeGreaterThan(r.tdee);
    expect(r.weekly).toBeGreaterThan(0);
  });

  it('uses 0.6 g/kg fat when that beats 25% of kcal', () => {
    const r = calcTargets({ ...base, sex: 'female', age: 90, height: 150, weight: 60, activity: 'sitting', days: 0, minutes: 0, goal: 'lose' });
    expect(r.fat).toBe(36);
    expect(r.fat).toBeGreaterThan(Math.round((r.kcal * 0.25) / 9));
  });
});

describe('bmrOf', () => {
  it('is Mifflin-St Jeor', () => {
    expect(bmrOf({ sex: 'male', age: 30, height: 165 }, 82)).toBe(1706.25);
    expect(bmrOf({ sex: 'female', age: 28, height: 158 }, 55)).toBe(1236.5);
  });
});

describe('num', () => {
  it.each([
    [72.5, 72.5],
    ['72,5', 72.5],
    ['72.5kg', 72.5],
    ['', 0],
    [null, 0],
    [undefined, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    ['abc', 0],
  ])('num(%p) = %p', (v, out) => {
    expect(num(v)).toBe(out);
  });
});
