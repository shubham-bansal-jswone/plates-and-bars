import content from '../../../content/exercises.json';
import {
  applyMods, calcTargets, clearHold, holdAfterSave, isFlagged, kcalTarget, LAB_TESTS_MAX, labFlag, labFlagRaw, labHistory,
  labHoldOn, labResult, markerOf, markerOfPrototype, MARKERS, normaliseUnit, planFlex, reportIsRed, sessionMods, sessionSets, suggestBase, tipFor,
  toTargetsProfile, undoFlex, validateLabReport,
  type ExerciseCatalog, type FlexEntry, type LabFlag, type KcalTargetProfile, type LabReport, type LabTest, type ModsContext, type SessionItem,
} from '../src/index';
import { rng } from './prototype-plan';
import { loadLabs } from './prototype-labs';

// No golden fixture covers lab reports (docs/spec/golden has none); the rules are checked against the prototype's own
// functions, cut from the HTML, plus a hand-written edge on both sides of every threshold.
const proto = loadLabs();
const t = (name: string, value: number | string, unit = '', low: number | string = '', high: number | string = ''): LabTest => ({ name, value: String(value), unit, low: String(low), high: String(high) });
const flagOf = (name: string, value: number | string, unit: string, low: number | string = '', high: number | string = '') => labFlag(t(name, value, unit, low, high));

describe('markerOf', () => {
  const cases: [string, string][] = [
    ['Vitamin D', 'vitamin_d'], ['25-OH Vit D', 'vitamin_d'], ['Vit B-12', 'vitamin_b12'], ['Cobalamin', 'vitamin_b12'],
    ['Ferritin', 'iron_ferritin'], ['Serum Iron', 'iron_ferritin'], ['Iron', 'iron_ferritin'], ['Haemoglobin', 'haemoglobin'],
    ['Hemoglobin', 'haemoglobin'], ['Hb', 'haemoglobin'], ['LDL Cholesterol', 'ldl'], ['HDL', 'hdl'], ['Triglycerides', 'triglycerides'],
    ['HbA1c', 'hba1c'], ['Glycated Hb', 'hba1c'], ['Fasting Glucose', 'glucose'], ['FBS', 'glucose'], ['Blood Sugar', 'glucose'],
    ['TSH', 'tsh'], ['Creatinine', 'creatinine'], ['SGPT', 'alt'], ['ALT', 'alt'], ['Alanine aminotransferase', 'alt'],
    ['SGOT', 'ast'], ['AST', 'ast'], ['Aspartate', 'ast'], ['Uric Acid', 'uric_acid'],
  ];
  it.each(cases)('%s is %s', (name, key) => {
    expect(markerOf(name)?.key).toBe(key);
  });
  it('has the 14 markers, and an unknown name is null', () => {
    expect(MARKERS).toHaveLength(14);
    expect(markerOf('Calcium')).toBeNull();
    expect(markerOf('Total Iron')).toBeNull(); // ^iron anchors to the start
  });
  it('pins the prototype gaps in markerOfPrototype: it matches inside words', () => {
    const key = (n: string) => markerOfPrototype(n)?.key;
    expect(key('VLDL')).toBe('ldl');
    expect(key('Non-HDL LDL')).toBe('ldl'); // LDL before HDL
    expect(key('Breast')).toBe('ast');
    expect(key('Salt')).toBe('alt');
    expect(key('Post-prandial glucose')).toBe('glucose');
    expect(key('Glycated Haemoglobin')).toBe('haemoglobin'); // Hb before HbA1c in order
  });
  it('markerOf uses word boundaries (#1075): inside a word is no match', () => {
    for (const n of ['Breast', 'VLDL', 'Salt', 'Cast', 'Last', 'Total Iron', 'Urinary glucosuria', 'HDLC2x']) expect(markerOf(n)).toBeNull();
    expect(markerOf('Glycated Haemoglobin')?.key).toBe('hba1c');
    expect(markerOf('Post-prandial glucose')?.key).toBe('glucose'); // still glucose
  });
  it.each([
    ['LDL Cholesterol', 'ldl'], ['LDL-C', 'ldl'], ['HDL Cholesterol', 'hdl'], ['Glucose PP', 'glucose'], ['SGOT (AST)', 'ast'],
    ['SGPT (ALT)', 'alt'], ['AST (SGOT)', 'ast'], ['ALT', 'alt'], ['Vitamin D3', 'vitamin_d'], ['Vit D, 25 Hydroxy', 'vitamin_d'],
    ['Haemoglobin (Hb)', 'haemoglobin'], ['HbA1c (Glycated)', 'hba1c'], ['Creatinine, Serum', 'creatinine'], ['Serum Ferritin', 'iron_ferritin'],
    ['Vitamin B12', 'vitamin_b12'], ['TSH Ultrasensitive', 'tsh'], ['Uric Acid', 'uric_acid'], ['Triglycerides', 'triglycerides'],
  ])('markerOf %s is %s', (name, key) => expect(markerOf(name)?.key).toBe(key));
  it('agrees with the prototype on names without in-word matches', () => {
    for (const [n] of cases) expect(markerOf(n)?.key).toBe(markerOfPrototype(n)?.key);
  });
  it('lists the tip sides', () => {
    expect(MARKERS.find((m) => m.key === 'tsh')?.tips).toEqual(['high', 'low']);
    expect(MARKERS.find((m) => m.key === 'vitamin_d')?.tips).toEqual(['low']);
  });
});

describe('red flags: both sides of every fixed threshold (lab range printed, canonical unit)', () => {
  it.each<[string, string, string, string, string, number, number, string, string]>([
    // name, unit, low, high, [just under], [at/over]
    ['HbA1c', '%', '4', '5.6', '', 8.9, 9, 'high', 'red'],
    ['HbA1c', '%', '4', '5.6', '', 9.1, 9.1, 'red', 'red'],
    ['Fasting glucose', 'mg/dL', '70', '100', '', 199.9, 200, 'high', 'red'],
    ['Fasting glucose', 'mg/dL', '70', '100', '', 55, 54.9, 'low', 'red'],
    ['Haemoglobin', 'g/dL', '13', '17', '', 8, 7.9, 'low', 'red'],
    ['TSH', 'mIU/L', '0.4', '4', '', 10, 10.1, 'high', 'red'],
    ['TSH', 'mIU/L', '0.4', '4', '', 0.1, 0.09, 'low', 'red'],
    ['LDL', 'mg/dL', '0', '100', '', 189.9, 190, 'high', 'red'],
    ['Triglycerides', 'mg/dL', '0', '150', '', 499.9, 500, 'high', 'red'],
  ])('%s %s (%s-%s): %s then %s', (name, unit, low, high, _x, under, over, fUnder, fOver) => {
    expect(flagOf(name, under, unit, low, high)).toBe(fUnder);
    expect(flagOf(name, over, unit, low, high)).toBe(fOver);
    expect(labFlagRaw(t(name, under, unit, low, high))).toBe(fUnder);
    expect(labFlagRaw(t(name, over, unit, low, high))).toBe(fOver);
  });

  it.each([
    ['Creatinine', '0.6', '1.2', 2.4, 2.41], // 2 x high
    ['ALT', '0', '40', 120, 120.1], // 3 x high
    ['AST', '0', '40', 120, 120.1],
    ['Uric acid', '3.5', '7', 10.5, 10.6], // 1.5 x high
  ])('%s: x high is high, just over is red', (name, low, high, at, over) => {
    expect(flagOf(name, at, name === 'ALT' || name === 'AST' ? 'U/L' : 'mg/dL', low, high)).toBe('high');
    expect(flagOf(name, over, name === 'ALT' || name === 'AST' ? 'U/L' : 'mg/dL', low, high)).toBe('red');
  });

  it('a marker with a fixed rule is red even with no printed range; a ratio rule with no high is not', () => {
    expect(flagOf('HbA1c', 9, '%')).toBe('red');
    expect(flagOf('Fasting glucose', 54, 'mg/dL')).toBe('red');
    expect(flagOf('Creatinine', 50, 'mg/dL', '0.6')).toBe('ok'); // above the low, no high printed, so no ratio rule
    expect(flagOf('Creatinine', 50, 'mg/dL')).toBe('none');
  });

  it('markers without a red rule never go red; ordinary high and low still show', () => {
    expect(flagOf('Vitamin D', 1, 'ng/mL', '30', '100')).toBe('low');
    expect(flagOf('Vitamin B12', 5000, 'pg/mL', '200', '900')).toBe('high');
    expect(flagOf('Ferritin', 1, 'ng/mL', '30', '300')).toBe('low');
    expect(flagOf('HDL', 5, 'mg/dL', '40', '60')).toBe('low');
  });

  it('inside the range is ok; a bound counts as inside', () => {
    expect(flagOf('HbA1c', 5, '%', '4', '5.6')).toBe('ok');
    expect(flagOf('Fasting glucose', 100, 'mg/dL', '70', '100')).toBe('ok');
    expect(flagOf('Fasting glucose', 70, 'mg/dL', '70', '100')).toBe('ok');
  });
});

describe('the generic rule (other tests, lab range only)', () => {
  it.each<[string, string, string, number, string]>([
    ['Calcium', '8', '10', 20, 'high'], // exactly 2x high
    ['Calcium', '8', '10', 20.1, 'red'],
    ['Calcium', '8', '10', 4, 'low'], // exactly 0.5x low
    ['Calcium', '8', '10', 3.9, 'red'],
    ['Calcium', '8', '10', 10.5, 'high'],
    ['Calcium', '8', '10', 9, 'ok'],
    ['Calcium', '', '10', 21, 'red'],
    ['Calcium', '', '10', 0, 'ok'],
    ['Calcium', '8', '', 3.9, 'red'],
    ['Calcium', '8', '', 100, 'ok'],
    ['Calcium', '', '', 100, 'none'],
  ])('%s %s-%s value %s is %s', (name, low, high, v, want) => {
    expect(flagOf(name, v, 'mg/dL', low, high)).toBe(want);
    expect(labFlagRaw(t(name, v, 'mg/dL', low, high))).toBe(want);
  });
  it('applies whatever the unit says, since it is a ratio of the lab\'s own range', () => {
    expect(labResult(t('Calcium', 21, 'whatever', '8', '10'))).toMatchObject({ flag: 'red', marker: null, unitStatus: 'none' });
    expect(labResult(t('Calcium', 21, '', '8', '10')).flag).toBe('red');
  });
});

describe('prototype quirks, pinned (see the spec-question issue)', () => {
  it('a blank value reads as 0, so a blank glucose is red in the prototype and in labFlagRaw', () => {
    expect(proto.labFlag({ name: 'Glucose', value: '', low: '70', high: '100' })).toBe('red');
    expect(labFlagRaw(t('Glucose', '', '', '70', '100'))).toBe('red');
  });
  it('labFlag and labResult deviate (#1075): a blank or junk value is none, a junk bound is no range', () => {
    expect(flagOf('Glucose', '', 'mg/dL', '70', '100')).toBe('none');
    expect(flagOf('Haemoglobin', ' ', 'g/dL')).toBe('none');
    expect(flagOf('HbA1c', 'abc', '%')).toBe('none');
    expect(flagOf('Calcium', '', '', '8', '10')).toBe('none');
    expect(labResult(t('Glucose', '', 'mg/dL')).value).toBeNull();
    expect(flagOf('Calcium', 5, '', 'abc', '')).toBe('none'); // junk low: no range at all
    expect(flagOf('Calcium', 21, '', 'abc', '10')).toBe('red'); // junk low ignored, high 10 kept
    expect(flagOf('Haemoglobin', 9, 'g/dL', 'x', 'y')).toBe('none');
    expect(flagOf('Haemoglobin', 7.9, 'g/dL', 'x', 'y')).toBe('red'); // fixed rule needs no range
  });
  it('a blank value never starts the hold', () => {
    const blank: LabReport = { id: 'z', date: '2026-10-01', tests: [t('Glucose', '', 'mg/dL', '70', '100'), t('Haemoglobin', '', 'g/dL'), t('TSH', 'n/a', 'mIU/L')] };
    expect(reportIsRed(blank)).toBe(false);
    expect(holdAfterSave(null, blank, '2026-10-03')).toBeNull();
    expect(reportIsRed({ tests: [t('Glucose', '', '', '70', '100')] })).toBe(false);
  });
  it('a junk bound reads as 0, not as no range', () => {
    expect(proto.labFlag({ name: 'Calcium', value: '5', low: 'abc', high: '' })).toBe(labFlagRaw(t('Calcium', 5, '', 'abc', '')));
  });
  it('a comma decimal is read', () => {
    expect(flagOf('HbA1c', '9,0', '%')).toBe('red');
  });
});

describe('matches the prototype over random tests in canonical units', () => {
  const r = rng(1070);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  it('15000 runs', () => {
    const names = ['HbA1c', 'Glucose', 'Hemoglobin', 'TSH', 'Creatinine', 'SGPT', 'SGOT', 'Uric Acid', 'LDL', 'HDL', 'Triglycerides', 'Vitamin D', 'B12', 'Ferritin', 'Calcium', 'Sodium'];
    const unitOf = (n: string): string => (markerOf(n)?.canonicalUnit ?? 'mg/dL');
    const reds = new Set<string>();
    for (let i = 0; i < 15000; i++) {
      const name = pick(names);
      const scale = pick([1, 10, 100, 1000]);
      const q = (): string => (r() < 0.25 ? '' : String(Math.round(r() * 20 * scale) / 10));
      const test = t(name, String(Math.round(r() * 30 * scale) / 10), unitOf(name), q(), q());
      const want = proto.labFlag(test);
      expect(labFlagRaw(test)).toBe(want);
      expect(labFlag(test)).toBe(want);
      if (want === 'red') reds.add(name);
    }
    expect(reds.size).toBeGreaterThan(10);
  });
});

describe('units', () => {
  // name, value, unit, low, high (as printed, in `unit`), expected flag, expected canonical value
  it.each<[string, string, number, string, string, string, LabFlag, number]>([
    ['glucose mmol/L x 18: 11.1 is 199.8', 'Fasting glucose', 11.1, 'mmol/L', '3.9', '5.6', 'high', 199.8],
    ['glucose 11.2 is 201.6', 'Fasting glucose', 11.2, 'mmol/L', '3.9', '5.6', 'red', 201.6],
    ['glucose 3.1 is 55.8', 'Fasting glucose', 3.1, 'mmol/L', '3.9', '5.6', 'low', 55.8],
    ['glucose 3 is 54', 'Fasting glucose', 3, 'mmol/L', '3.9', '5.6', 'red', 54],
    ['LDL mmol/L x 38.67: 4.9 is 189.483', 'LDL', 4.9, 'mmol/L', '0', '2.6', 'high', 189.483],
    ['LDL 4.92 is 190.2564', 'LDL', 4.92, 'mmol/L', '0', '2.6', 'red', 190.2564],
    ['triglycerides x 88.57: 5.6 is 495.992', 'Triglycerides', 5.6, 'mmol/L', '0', '1.7', 'high', 495.992],
    ['triglycerides 5.65 is 500.4205', 'Triglycerides', 5.65, 'mmol/L', '0', '1.7', 'red', 500.4205],
    ['HbA1c mmol/mol: 74 is 8.9215', 'HbA1c', 74, 'mmol/mol', '20', '38', 'high', 8.9215],
    ['HbA1c 75 is 9.013', 'HbA1c', 75, 'mmol/mol', '20', '38', 'red', 9.013],
    ['haemoglobin g/L: 80 is 8', 'Haemoglobin', 80, 'g/L', '130', '170', 'low', 8],
    ['haemoglobin 79 is 7.9', 'Haemoglobin', 79, 'g/L', '130', '170', 'red', 7.9],
    ['creatinine umol/L: 106 is 1.1991', 'Creatinine', 106, 'µmol/L', '53', '106', 'ok', 1.1991],
    ['creatinine 2x high is not red, just over is', 'Creatinine', 212, 'umol/L', '53', '106', 'high', 2.3981],
    ['creatinine 214 umol/L is red', 'Creatinine', 214, 'umol/L', '53', '106', 'red', 2.4208],
  ])('%s', (_label, name, value, unit, low, high, flag, canonical) => {
    const res = labResult(t(name, value, unit, low, high));
    expect(res.unitStatus).toBe('converted');
    expect(res.value).toBeCloseTo(canonical, 3);
    expect(res.flag).toBe(flag);
  });

  it('converts the lab range with the value', () => {
    const res = labResult(t('Fasting glucose', 5, 'mmol/L', '3.9', '5.6'));
    expect([res.low, res.high, res.value]).toEqual([70.2, 100.8, 90]);
    expect(res.flag).toBe('ok');
    expect(res.unit).toBe('mg/dL');
  });

  it('other known units convert: vitamin D nmol/L, B12 pmol/L, uric acid umol/L, serum iron umol/L', () => {
    expect(labResult(t('Vitamin D', 75, 'nmol/L', '50', '125'))).toMatchObject({ unitStatus: 'converted', flag: 'ok' });
    expect(labResult(t('Vitamin D', 75, 'nmol/L')).value).toBeCloseTo(30.0481, 3);
    expect(labResult(t('Vitamin B12', 200, 'pmol/L')).value).toBeCloseTo(271, 3);
    expect(labResult(t('Uric acid', 500, 'umol/L', '', '7')).value).toBeCloseTo(8.4062, 3);
    expect(labResult(t('Serum Iron', 10, 'umol/L')).unit).toBe('ug/dL');
    expect(labResult(t('Ferritin', 50, 'ug/L')).unit).toBe('ng/mL');
  });

  it('same-size units are canonical, whatever the spelling or case', () => {
    for (const [name, unit] of [['Glucose', 'MG/DL'], ['Glucose', ' mg / dl '], ['TSH', 'uIU/mL'], ['TSH', 'µIU/mL'], ['ALT', 'IU/L'], ['AST', 'U/L'], ['Hb', 'gm/dl'], ['HbA1c', '%'], ['Vitamin D', 'ug/L'], ['Vitamin D', 'mcg/L'], ['Ferritin', 'ng/mL'], ['Serum Iron', 'mcg/dL']] as const) {
      expect(labResult(t(name, 1, unit)).unitStatus).toBe('canonical');
    }
    expect(normaliseUnit('µmol/L.')).toBe('umol/l');
    expect(normaliseUnit('μmol/L')).toBe('umol/l');
  });

  it('an unknown or missing unit is never red: it shows high, low, ok or none and says "unrecognised"', () => {
    for (const unit of ['', 'mg/L', 'IU', 'x', 'g/dL' /* wrong marker */]) {
      const res = labResult(t('Fasting glucose', 400, unit, '70', '100'));
      expect(res).toMatchObject({ flag: 'high', unitStatus: 'unrecognised', value: 400, unit });
    }
    expect(labResult(t('HbA1c', 20, 'g/dL')).flag).toBe('none');
    expect(labResult(t('Haemoglobin', 1, '', '13', '17')).flag).toBe('low');
    expect(labResult(t('Haemoglobin', 15, 'xx', '13', '17')).flag).toBe('ok');
    expect(labResult(t('Ferritin', 1, 'ug/dL', '30', '300')).unitStatus).toBe('unrecognised'); // ferritin is not in ug/dL
    expect(labResult(t('Serum Iron', 1, 'ng/mL')).unitStatus).toBe('unrecognised');
  });

  it('red is only held back by the unit: the same numbers in a known unit go red', () => {
    expect(flagOf('Fasting glucose', 250, 'mg/dL', '70', '100')).toBe('red');
    expect(flagOf('Fasting glucose', 250, 'mg/L', '70', '100')).toBe('high');
  });
});

describe('tips, flagged cards and history', () => {
  it('red has its own notice; low and high pick the side; no tip on that side is generic', () => {
    expect(tipFor('red', 'glucose')).toBe('red');
    expect(tipFor('red', null)).toBe('red');
    expect(tipFor('low', 'vitamin_d')).toBe('low');
    expect(tipFor('high', 'vitamin_d')).toBe('generic');
    expect(tipFor('high', 'ldl')).toBe('high');
    expect(tipFor('low', 'ldl')).toBe('generic');
    expect(tipFor('low', 'tsh')).toBe('low');
    expect(tipFor('high', 'tsh')).toBe('high');
    expect(tipFor('high', null)).toBe('generic');
  });
  it('flagged is anything but ok and none', () => {
    expect(['red', 'high', 'low', 'ok', 'none'].map((f) => isFlagged(f as 'red'))).toEqual([true, true, true, false, false]);
  });
  it('history: same marker or the exact same name, oldest first, reports without one skipped', () => {
    const rep = (date: string, ...tests: LabTest[]): LabReport => ({ id: date, date, tests });
    const reports = [rep('2026-01-01', t('Hemoglobin', 11)), rep('2026-02-01', t('TSH', 3)), rep('2026-03-01', t('Haemoglobin', 12), t('Calcium', 9)), rep('2026-04-01', t('Calcium', 9.5))];
    expect(labHistory(reports, t('Haemoglobin', 12))).toEqual([{ date: '2026-01-01', value: '11' }, { date: '2026-03-01', value: '12' }]);
    expect(labHistory(reports, t('Calcium', 9))).toEqual([{ date: '2026-03-01', value: '9' }, { date: '2026-04-01', value: '9.5' }]);
    expect(labHistory(reports, t('Zinc', 1))).toEqual([]);
  });
});

describe('hold state', () => {
  const red: LabReport = { id: 'a', date: '2026-10-01', tests: [t('Calcium', 5, 'mg/dL', '8', '10'), t('HbA1c', 9.5, '%')] };
  const clean: LabReport = { id: 'b', date: '2026-10-02', tests: [t('HbA1c', 5, '%', '4', '5.6')] };
  it('a red result starts the hold on the save date; a clean report leaves it as it was', () => {
    expect(reportIsRed(red)).toBe(true);
    expect(reportIsRed(clean)).toBe(false);
    expect(holdAfterSave(null, red, '2026-10-03')).toEqual({ on: true, since: '2026-10-03' });
    expect(holdAfterSave({ on: true, since: '2026-09-01' }, red, '2026-10-03')).toEqual({ on: true, since: '2026-10-03' });
    expect(holdAfterSave({ on: true, since: '2026-09-01' }, clean, '2026-10-03')).toEqual({ on: true, since: '2026-09-01' });
    expect(holdAfterSave(undefined, clean, '2026-10-03')).toBeNull();
  });
  it('"I have seen my doctor" clears it; labHoldOn reads it', () => {
    expect(clearHold()).toEqual({ on: false });
    expect([labHoldOn(null), labHoldOn(undefined), labHoldOn({ on: false }), labHoldOn({ on: true })]).toEqual([false, false, false, true]);
  });
  it('an unrecognised unit cannot start the hold', () => {
    expect(reportIsRed({ tests: [t('Glucose', 400, 'mg/L', '70', '100')] })).toBe(false);
  });
});

describe('review fixes (#1075)', () => {
  it.each(['Glycosylated Haemoglobin', 'Hemoglobin A1c', 'Hb A1c', 'HbA1c', 'Glycated Hemoglobin', 'A1c'])('%s is HbA1c, never haemoglobin', (n) => {
    expect(markerOf(n)?.key).toBe('hba1c');
  });
  it('plain haemoglobin and Hb still map to haemoglobin', () => {
    expect(markerOf('Hb')?.key).toBe('haemoglobin');
    expect(markerOf('Hemoglobin (Hb)')?.key).toBe('haemoglobin');
    expect(markerOf('Hb %')?.key).toBe('haemoglobin');
  });
  it('a Hb A1c of 9.5 is red as HbA1c, not read against haemoglobin', () => {
    expect(labResult(t('Hb A1c', 9.5, '%'))).toMatchObject({ marker: 'hba1c', flag: 'red' });
  });
  it('mg% is mg/dL', () => {
    expect(labResult(t('Fasting glucose', 250, 'mg%', '70', '100'))).toMatchObject({ flag: 'red', unitStatus: 'canonical', unit: 'mg/dL' });
    expect(labResult(t('LDL', 191, 'mg%')).flag).toBe('red');
  });
  it('urine names never map to a blood marker: generic rule only, no hold from the glucose threshold', () => {
    for (const n of ['Urine Glucose', 'Glucose, Urine', 'Urine Creatinine', 'Urine Protein']) expect(markerOf(n)).toBeNull();
    expect(labResult(t('Urine Glucose', 250, 'mg/dL', '0', '15'))).toMatchObject({ marker: null, flag: 'red' }); // far outside the lab's own range
    expect(flagOf('Urine Glucose', 250, 'mg/dL')).toBe('none'); // no range: no fixed threshold
    expect(reportIsRed({ tests: [t('Urine Glucose', 250, 'mg/dL')] })).toBe(false);
    expect(flagOf('Urine Glucose', 25, 'mg/dL', '0', '15')).toBe('high');
  });
  it('Non-HDL cholesterol never maps to hdl: generic rule', () => {
    for (const n of ['Non-HDL Cholesterol', 'Non HDL Cholesterol', 'NonHDL']) expect(markerOf(n)).toBeNull();
    expect(markerOf('HDL Cholesterol')?.key).toBe('hdl');
    expect(flagOf('Non-HDL Cholesterol', 130, 'mg/dL', '0', '130')).toBe('ok');
    expect(flagOf('Non-HDL Cholesterol', 131, 'mg/dL', '0', '130')).toBe('high');
  });
  it('validateLabReport: a marker name with a blank unit is unit_missing; other names need no unit', () => {
    const rep = (...tests: LabTest[]): LabReport => ({ id: 'r', date: '2026-10-01', tests });
    expect(validateLabReport(rep(t('Fasting glucose', 90, '')))).toBe('unit_missing');
    expect(validateLabReport(rep(t('Fasting glucose', 90, '  ')))).toBe('unit_missing');
    expect(validateLabReport(rep(t('Fasting glucose', 90, 'mg/dL')))).toBeNull();
    expect(validateLabReport(rep(t('Urine Glucose', 90, '')))).toBeNull();
    expect(validateLabReport(rep(t('Calcium', 9, '')))).toBeNull();
  });
});

describe('validateLabReport', () => {
  const ok = (tests: LabTest[] = [t('HbA1c', 5.4, '%', '4', '5.6')], date = '2026-10-01'): LabReport => ({ id: 'r', date, tests });
  it('accepts a good report, empty bounds, comma decimals and a negative value', () => {
    expect(validateLabReport(ok())).toBeNull();
    expect(validateLabReport(ok([t('X', '1,5', '', '', '')]))).toBeNull();
    expect(validateLabReport(ok([t('X', ' -2 ', '', ' ', '')]))).toBeNull();
  });
  it.each([
    ['2026-13-01', 'bad_date'], ['2026-02-30', 'bad_date'], ['26-10-01', 'bad_date'], ['', 'bad_date'], ['2026-10-1', 'bad_date'],
  ])('date %s is %s', (d, e) => expect(validateLabReport(ok(undefined, d))).toBe(e));
  it('the other errors', () => {
    expect(validateLabReport(ok([]))).toBe('no_tests');
    expect(validateLabReport(ok(Array.from({ length: LAB_TESTS_MAX + 1 }, () => t('X', 1))))).toBe('too_many_tests');
    expect(validateLabReport(ok(Array.from({ length: LAB_TESTS_MAX }, () => t('X', 1))))).toBeNull();
    expect(validateLabReport(ok([t(' ', 1)]))).toBe('name_missing');
    expect(validateLabReport(ok([t('x'.repeat(101), 1)]))).toBe('name_too_long');
    expect(validateLabReport(ok([t('X', '')]))).toBe('value_not_number');
    expect(validateLabReport(ok([t('X', 'abc')]))).toBe('value_not_number');
    expect(validateLabReport(ok([t('X', '1e5')]))).toBe('value_not_number');
    expect(validateLabReport(ok([t('X', 1, '', 'abc')]))).toBe('low_not_number');
    expect(validateLabReport(ok([t('X', 1, '', '', '1..2')]))).toBe('high_not_number');
    expect(validateLabReport(ok([t('X', 1, 'u'.repeat(101))]))).toBe('unit_too_long');
  });
});

describe('the hold reaches calories, flex and workouts (existing core wiring, pinned)', () => {
  const p: KcalTargetProfile = { sex: 'male', age: 30, height_cm: 175, weight_kg: 80, activity: 'sitting', days: 3, minutes: 60, goal: 'lose', pace: 'moderate', special: 'none', targets: { kcal: 1900 } };
  const maint = Math.round(calcTargets(toTargetsProfile(p)).tdee / 10) * 10;
  const flex: FlexEntry[] = [{ id: 'a', date: '2026-10-08', kcal_delta: 500 }, { id: 'a', date: '2026-10-09', kcal_delta: -200 }];

  it('kcal: hold off is the saved target plus flex; hold on is at least maintenance and ignores flex', () => {
    expect(kcalTarget('2026-10-08', { flex, labHold: false }, p)).toBe(2400);
    expect(kcalTarget('2026-10-09', { flex, labHold: false }, p)).toBe(1700);
    expect(kcalTarget('2026-10-08', { flex, labHold: true }, p)).toBe(maint);
    expect(kcalTarget('2026-10-09', { flex, labHold: true }, p)).toBe(maint);
    expect(maint).toBeGreaterThan(1900);
    expect(kcalTarget('2026-10-09', { flex, labHold: true }, { ...p, targets: { kcal: maint + 300 } })).toBe(maint + 300);
  });

  it('flex: planFlex and undoFlex take the hold; a hold never plans a bigger cut than without it', () => {
    const input = { extra: 500, date: '2026-10-08', today: '2026-10-08', id: 'n', flex: [] as FlexEntry[] };
    const off = planFlex(input, p);
    const on = planFlex({ ...input, labHold: true }, p);
    expect(off.flex.filter((x) => x.kcal_delta < 0).length).toBeGreaterThan(0);
    expect(on.flex.filter((x) => x.kcal_delta < 0).length).toBeGreaterThan(0); // 1900 target has room above the floor either way
    const low = { ...p, targets: { kcal: 1500 } };
    expect(planFlex({ ...input, labHold: true }, low).per).toBeLessThanOrEqual(planFlex(input, low).per);
    expect(undoFlex(off.flex, 'n', { profile: p, labHold: true })).toEqual(undoFlex(off.flex, 'n', { profile: p }));
  });

  const catalog = content as ExerciseCatalog;
  const items: SessionItem[] = [{ name: 'Hack Squat' }, { name: 'Lateral Raise' }];
  const lastSets = (): number => 4;
  const date = '2026-10-07';
  const sets = (labHold: boolean): number[] => {
    const { setsLight } = sessionMods({ date, where: 'gym', labHold });
    return sessionSets(items, { date, tags: catalog.tags, lastSets, light: setsLight }).map((e) => e.sets);
  };
  it('workout: the hold drops one set from exercises with more than 2 sets', () => {
    const off = sets(false);
    const on = sets(true);
    expect(off.some((n) => n > 2)).toBe(true);
    expect(on).toEqual(off.map((n) => (n > 2 ? n - 1 : n)));
    expect(sessionMods({ date, where: 'gym', labHold: true }).mods.light).toBe(true);
    expect(sessionMods({ date, where: 'gym', labHold: false }).mods.light).toBe(false);
  });
  it('workout: a 2-set exercise keeps its 2 sets under the hold', () => {
    const two = sessionSets([{ name: 'Single-Leg Balance (seconds)' }, { name: 'Hack Squat', bridge: true }], { date, tags: catalog.tags, light: true });
    expect(two.find((e) => e.name === 'Hack Squat')?.sets).toBe(2);
  });
  it('workout: mods.light stops weight increases (applyMods reads it); hold off lets them through', () => {
    const lift = { date: '2026-10-01', first: '2026-08-01', sets: [{ w: 60, r: 12 }, { w: 60, r: 12 }] };
    const run = (labHold: boolean) => {
      const c: ModsContext = { date, lifts: { 'Hack Squat': lift }, catalog, mods: sessionMods({ date, where: 'gym', labHold }).mods };
      return applyMods(suggestBase({ name: 'Hack Squat' }, c), { name: 'Hack Squat' }, c);
    };
    expect(run(false)).toMatchObject({ mode: 'up', w: 65 });
    expect(run(true)).toMatchObject({ mode: 'hold', w: 60 });
    expect(run(true).reason).toContain('No weight increase today.');
  });
});
