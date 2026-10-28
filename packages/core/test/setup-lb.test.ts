import { DEFAULT_STEP, EXERCISE_STEP_CHOICES, LB_STEP_CHOICES, lbStepFor, lbToKg, normaliseSetup, setupSummary, validateSetupStep, type ExType, type SetupAnswers } from '../src/index';

const TODAY = '2026-10-08';
const valid = (more: Partial<SetupAnswers> = {}): SetupAnswers => ({
  sex: 'male', special: 'none', age: '30', unit: 'cm', cm: '175', weight: '80', activity: 'light', where: 'gym', days: 3, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate',
  screen: { 0: 'no', 1: 'no', 2: 'no', 3: 'no', 4: 'no', 5: 'no' }, ...more,
});

describe('setup in pounds (#1185)', () => {
  it('whole pounds 100 to 400: the saved weight is the exact kg, and the saved targets are the ones the results screen computes', () => {
    let n = 0;
    for (const sex of ['male', 'female'] as const)
      for (const goal of ['lose', 'maintain', 'gain'] as const)
        for (let lb = 100; lb <= 400; lb++) {
          const p = normaliseSetup(valid({ sex, goal, weight: String(lb) }), TODAY, null, 'lb');
          expect(p.weight_kg).toBe(lbToKg(lb));
          const t = setupSummary(p).targets;
          expect({ kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat }).toEqual(p.targets);
          n++;
        }
    expect(n).toBe(1806);
  });

  it('102 lb, male, lose: the targets come from the same weight that is saved', () => {
    const p = normaliseSetup(valid({ goal: 'lose', weight: '102' }), TODAY, null, 'lb');
    expect(p.targets.kcal).toBe(setupSummary(p).targets.kcal);
  });

  it('the box is rounded to 0.1 lb first, and the bounds are checked in kg', () => {
    expect(normaliseSetup(valid({ weight: '180.04' }), TODAY, null, 'lb').weight_kg).toBe(lbToKg(180));
    expect(validateSetupStep(0, valid({ weight: '60' }), 'lb')).toBe('weight_out_of_range'); // 27 kg
    expect(validateSetupStep(0, valid({ weight: '67' }), 'lb')).toBeNull(); // 30.4 kg
    expect(validateSetupStep(0, valid({ weight: '661' }), 'lb')).toBeNull(); // 299.8 kg
    expect(validateSetupStep(0, valid({ weight: '662' }), 'lb')).toBe('weight_out_of_range'); // 300.3 kg
  });

  it('a stored kg left alone is kept exactly, and the targets come from it', () => {
    const p = normaliseSetup(valid({ weight: '176.4' }), TODAY, null, 'lb', 80);
    expect(p.weight_kg).toBe(80);
    expect(p.targets).toEqual(normaliseSetup(valid({ weight: '80' }), TODAY).targets);
  });

  it('kg is unchanged: rounded to 0.1 kg when saved, and exactKg is ignored', () => {
    expect(normaliseSetup(valid({ weight: '80.26' }), TODAY).weight_kg).toBe(80.3);
    expect(normaliseSetup(valid({ weight: '80.26' }), TODAY, null, 'kg', 79).weight_kg).toBe(80.3);
  });
});

describe('the lb jump choices (#1185)', () => {
  it('are 2.5, 5 and 10 lb, and each reads back as itself from its exact kg for every loaded type', () => {
    expect(LB_STEP_CHOICES).toEqual([2.5, 5, 10]);
    for (const type of ['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'other'] as ExType[])
      for (const x of LB_STEP_CHOICES) expect(lbStepFor(type, lbToKg(x), DEFAULT_STEP[type])).toBe(x);
    expect(EXERCISE_STEP_CHOICES).toContain(2.5); // the kg list is separate
  });
});
