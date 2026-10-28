import content from '../../../content/exercises.json';
import {
  DEFAULT_STEP,
  KG_PER_LB,
  suggestBase,
  applyMods,
  LB_STEP,
  easier,
  exInfo,
  formatWeight,
  fromKg,
  harder,
  infoForUnit,
  kgLabel,
  kgToLb,
  lbStepFor,
  lbToKg,
  parseWeightInput,
  snap,
  snapForUnit,
  toKg,
  unitLabel,
  DEFAULT_WEIGHT_UNIT,
  type ExType,
} from '../src';

const catalog = { meta: content.meta } as unknown as Parameters<typeof exInfo>[1];
const info = (type: ExType, step = DEFAULT_STEP[type]) => ({ type, lo: 8, hi: 12, step });

describe('conversion', () => {
  it('uses the exact factor', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(lbToKg(1)).toBe(0.45359237);
    expect(lbToKg(225)).toBeCloseTo(102.05828325, 9);
    expect(kgToLb(100)).toBeCloseTo(220.462262, 6);
  });
  it('round-trips', () => {
    for (const v of [0, 0.1, 2.5, 20, 61.3, 100, 317.5]) {
      expect(kgToLb(lbToKg(v))).toBeCloseTo(v, 10);
      expect(lbToKg(kgToLb(v))).toBeCloseTo(v, 10);
    }
  });
  it('kg passes through', () => {
    expect(fromKg(82.5)).toBe(82.5);
    expect(toKg(82.5, 'kg')).toBe(82.5);
    expect(fromKg(1, 'lb')).toBeCloseTo(2.2046, 4);
    expect(toKg(1, 'lb')).toBe(KG_PER_LB);
    expect(DEFAULT_WEIGHT_UNIT).toBe('kg');
    expect(unitLabel()).toBe('kg');
    expect(unitLabel('lb')).toBe('lb');
  });
});

describe('formatWeight', () => {
  it('kg is the old r1 output', () => {
    expect(formatWeight(82.5)).toBe('82.5');
    expect(formatWeight(80)).toBe('80');
    expect(formatWeight(22.449)).toBe('22.4');
    expect(formatWeight(0)).toBe('0');
  });
  it('lb rounds to one decimal', () => {
    expect(formatWeight(100, 'lb')).toBe('220.5');
    expect(formatWeight(lbToKg(225), 'lb')).toBe('225');
    expect(formatWeight(0, 'lb')).toBe('0');
    expect(formatWeight(20, 'lb')).toBe('44.1');
  });
});

describe('parseWeightInput', () => {
  it('kg passes the number through', () => {
    expect(parseWeightInput('82,5')).toBe(82.5);
    expect(parseWeightInput('0')).toBe(0);
  });
  it('lb converts to kg', () => {
    expect(parseWeightInput('225', 'lb')).toBeCloseTo(102.05828325, 9);
    expect(parseWeightInput('2,5', 'lb')).toBeCloseTo(1.133980925, 9);
    expect(formatWeight(parseWeightInput('135', 'lb') as number, 'lb')).toBe('135');
  });
  it('rejects junk, empty and negatives', () => {
    for (const t of ['', 'abc', null, undefined, '-5', NaN, Infinity]) expect(parseWeightInput(t, 'lb')).toBeNull();
  });
});

describe('kgLabel', () => {
  it('kg output unchanged for every type', () => {
    expect(kgLabel(12.5, info('dumbbell'))).toBe('12.5 kg each');
    expect(kgLabel(12.5, info('dumbbell'), 'kg')).toBe('12.5 kg each');
    expect(kgLabel(30, info('assisted'))).toBe('30 kg assist');
    expect(kgLabel(60, info('barbell'))).toBe('60 kg');
    expect(kgLabel(0, info('machine'))).toBe('0 kg');
    expect(kgLabel(22.449, exInfo('Hammer Curl', catalog))).toBe('22.4 kg each');
  });
  it('lb examples', () => {
    expect(kgLabel(22.67962, info('dumbbell'), 'lb')).toBe('50 lb each');
    expect(kgLabel(100, info('barbell'), 'lb')).toBe('220.5 lb');
    expect(kgLabel(lbToKg(40), info('assisted'), 'lb')).toBe('40 lb assist');
  });
});

describe('lb steps', () => {
  it('maps default kg steps to named lb steps', () => {
    expect(LB_STEP).toEqual({ barbell: 5, dumbbell: 2.5, machine: 5, cable: 5, assisted: 5, other: 2.5, bodyweight: 0, time: 0 });
    for (const t of Object.keys(DEFAULT_STEP) as ExType[]) expect(lbStepFor(t, DEFAULT_STEP[t], DEFAULT_STEP[t])).toBe(LB_STEP[t]);
  });
  it('maps custom kg steps by conversion, at least 2.5 lb', () => {
    expect(lbStepFor('barbell', 1.25, 2.5)).toBe(2.5);
    expect(lbStepFor('barbell', 0.5, 2.5)).toBe(2.5);
    expect(lbStepFor('barbell', 10, 2.5)).toBe(22.5);
    expect(lbStepFor('barbell', 0, 2.5)).toBe(0);
    expect(lbStepFor('machine', 2.5, 5)).toBe(5);
  });
  it('infoForUnit leaves kg alone and expresses lb steps in kg', () => {
    const i = info('barbell');
    expect(infoForUnit(i)).toBe(i);
    expect(infoForUnit(i, 'kg')).toBe(i);
    expect(infoForUnit(i, 'lb').step).toBeCloseTo(lbToKg(5), 12);
    expect(infoForUnit(info('bodyweight'), 'lb').step).toBe(0);
  });
  it('harder and easier move in whole lb', () => {
    const i = infoForUnit(info('barbell'), 'lb');
    const w = lbToKg(135);
    expect(formatWeight(harder(w, i), 'lb')).toBe('140');
    expect(formatWeight(easier(w, i, 0.075), 'lb')).toBe('125');
  });
  it('snapForUnit: kg equals snap, lb rounds to the lb step', () => {
    for (const x of [0, 1.1, 61.3, 62.4, 100]) expect(snapForUnit(x, info('barbell'))).toBe(snap(x, 2.5));
    expect(formatWeight(snapForUnit(100, info('barbell'), 'lb'), 'lb')).toBe('220');
    expect(formatWeight(snapForUnit(100, info('barbell'), 'lb'), 'lb')).not.toBe('220.5');
    expect(formatWeight(snapForUnit(lbToKg(52.4), info('dumbbell'), 'lb'), 'lb')).toBe('52.5');
    expect(snapForUnit(61.234, info('bodyweight'), 'lb')).toBeCloseTo(61.234, 10);
    expect(formatWeight(snapForUnit(lbToKg(137.5), info('barbell'), 'lb'), 'lb')).toBe('140'); // half rounds up
  });
});

describe('suggestions in lb (ProgressionContext.unit)', () => {
  const sets = (w: number, rate?: 'easy') => [1, 2, 3].map(() => ({ w, r: 12, ...(rate ? { rate } : {}) }));
  const ctx = (w: number, unit?: 'kg' | 'lb', extra = {}) =>
    ({
      date: '2026-03-01',
      lifts: { 'Barbell Row': { date: '2026-02-20', sets: sets(w, 'easy'), first: '2026-01-01' } },
      catalog,
      unit,
      ...extra,
    }) as unknown as Parameters<typeof suggestBase>[1];
  const ex = { name: 'Barbell Row' };

  it('kg output is identical with and without unit', () => {
    const a = suggestBase(ex, ctx(60));
    expect(suggestBase(ex, ctx(60, 'kg'))).toEqual(a);
    expect(a.text).toContain(' kg');
    expect(a.reason).toContain('add 2.5 kg');
  });
  it('a stored 61.23 kg shows 135 lb and a barbell lb user steps 5 lb', () => {
    const top = lbToKg(135);
    expect(formatWeight(top, 'lb')).toBe('135');
    const s = suggestBase(ex, ctx(top, 'lb'));
    expect(s.mode).toBe('up');
    expect(s.text).toBe('140 lb × 8–12 reps');
    expect(s.reason).toContain('Last time: 3 × 135 lb, 12, 12, 12 reps');
    expect(s.reason).toContain('add 5 lb');
    expect(s.reason).not.toContain(' kg');
    expect(formatWeight(s.w as number, 'lb')).toBe('140');
  });
  it('hold and mods text show lb', () => {
    const top = lbToKg(135);
    const c = ctx(top, 'lb', { mods: { deload: true } });
    const s = applyMods(suggestBase(ex, c), ex, c as never);
    expect(s.text).toMatch(/ lb × 8–12 reps$/);
    expect(s.reason).not.toContain(' kg');
  });
  it('lb drop text and bridge', () => {
    const c = ctx(lbToKg(100), 'lb');
    (c.lifts['Barbell Row'] as { sets: unknown }).sets = [{ w: lbToKg(100), r: 5, rate: 'fail' }];
    const s = suggestBase(ex, c);
    expect(s.mode).toBe('down');
    expect(s.text).toMatch(/^\d+(\.\d)? lb × /);
  });
});
