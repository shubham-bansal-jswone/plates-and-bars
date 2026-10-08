import {
  AGE_MAX,
  AGE_MIN,
  BURN_RANGE,
  DAY_CHOICES,
  DEFICIT_CAP_KCAL,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  PACE_STEADY_KCAL,
  SCREEN_QUESTIONS,
  SESSION_MINUTES,
  SETUP_STEPS,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  calcTargets,
  cmToFtIn,
  ftInToCm,
  normaliseSetup,
  setupSummary,
  toTargetsProfile,
  validateSetup,
  validateSetupStep,
  type SetupAnswers,
  type SetupError,
  type SetupNote,
  type SetupProfile,
} from '../src/index';
import { prototypeSource } from './helpers';
import { rng } from './prototype-plan';
import { loadSetup, type ProtoP } from './prototype-setup';

const TODAY = '2026-10-08';
const allNo = { 0: 'no', 1: 'no', 2: 'no', 3: 'no', 4: 'no', 5: 'no' } as const;

/** A complete, valid answer set; override fields per test. */
const valid = (more: Partial<SetupAnswers> = {}): SetupAnswers => ({
  sex: 'male',
  special: 'none',
  age: '30',
  unit: 'cm',
  cm: '175',
  weight: '80',
  activity: 'light',
  where: 'gym',
  days: 3,
  exp: 'some',
  minutes: 60,
  goal: 'lose',
  pace: 'moderate',
  screen: allNo,
  ...more,
});

describe('constants', () => {
  it('match the prototype setup screen', () => {
    expect([AGE_MIN, AGE_MAX, HEIGHT_MIN_CM, HEIGHT_MAX_CM, WEIGHT_MIN_KG, WEIGHT_MAX_KG]).toEqual([18, 90, 120, 230, 30, 300]);
    expect(SESSION_MINUTES).toEqual([30, 45, 60, 75, 90]);
    expect(DAY_CHOICES).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([SETUP_STEPS, SCREEN_QUESTIONS, BURN_RANGE, PACE_STEADY_KCAL, DEFICIT_CAP_KCAL]).toEqual([4, 6, 0.1, 20, 750]);
  });
  it('are the ones the prototype source uses', () => {
    const src = prototypeSource();
    expect(src).toContain("[30,45,60,75,90].map(m => chip('minutes', m, m + ' min'))");
    expect(src).toContain("${chip('days',0,'None yet')}${[1,2,3,4,5,6,7].map(d => chip('days', d, String(d))).join('')}");
    expect(loadSetup(TODAY).SCREEN_Q).toHaveLength(SCREEN_QUESTIONS);
  });
});

describe('ftInToCm and cmToFtIn', () => {
  it('converts ft/in to unrounded cm, parsing text with num', () => {
    expect(ftInToCm(5, 7)).toBeCloseTo(170.18, 10);
    expect(ftInToCm('5', '7.5')).toBeCloseTo(171.45, 10);
    expect(ftInToCm('6', '')).toBeCloseTo(182.88, 10);
    expect(ftInToCm('', '')).toBe(0);
  });
  it('converts cm to whole ft and in, carrying 12 in', () => {
    expect(cmToFtIn(170.2)).toEqual({ ft: 5, inch: 7 });
    expect(cmToFtIn(182.5)).toEqual({ ft: 6, inch: 0 }); // 71.85 in rounds to 12 in → 6′0″
    expect(cmToFtIn(152.4)).toEqual({ ft: 5, inch: 0 });
  });
});

describe('validateSetupStep', () => {
  const code = (step: number, more: Partial<SetupAnswers>) => validateSetupStep(step, valid(more));
  it('passes complete answers on every step, and the results step always', () => {
    for (let s = 0; s <= SETUP_STEPS; s++) expect(code(s, {})).toBeNull();
    expect(validateSetupStep(4, { sex: '', age: '', unit: 'cm', weight: '', activity: '', days: null, goal: '' })).toBeNull();
  });
  it('step 0: sex, age, height, weight in that order', () => {
    expect(code(0, { sex: '', age: '' })).toBe('sex_missing');
    expect(code(0, { age: '' })).toBe('age_missing');
    expect(code(0, { age: '0.4' })).toBe('age_missing'); // rounds to 0
    expect(code(0, { age: '17.4' })).toBe('age_under_min');
    expect(code(0, { age: '17.5' })).toBeNull(); // rounds to 18
    expect(code(0, { age: '90.5' })).toBe('age_over_max');
    expect(code(0, { age: '-5' })).toBe('age_under_min');
    expect(code(0, { cm: '119.9' })).toBe('height_cm_out_of_range');
    expect(code(0, { cm: '230.1' })).toBe('height_cm_out_of_range');
    expect(code(0, { cm: '120' })).toBeNull();
    expect(code(0, { unit: 'ft', ft: '3', inch: '11' })).toBe('height_ft_out_of_range');
    expect(code(0, { unit: 'ft', ft: '5', inch: '7' })).toBeNull();
    expect(code(0, { weight: '29.9' })).toBe('weight_out_of_range');
    expect(code(0, { weight: '300.1' })).toBe('weight_out_of_range');
    expect(code(0, { weight: '72,5' })).toBeNull();
  });
  it('PINNED QUIRK: limits apply before rounding, so 29.96 kg fails although it saves as 30', () => {
    expect(code(0, { weight: '29.96' })).toBe('weight_out_of_range');
    expect(code(0, { cm: '119.96' })).toBe('height_cm_out_of_range');
  });
  it('step 1: activity', () => {
    expect(code(1, { activity: '' })).toBe('activity_missing');
  });
  it('step 2: days, then where, experience and minutes only when training', () => {
    expect(code(2, { days: null })).toBe('days_missing');
    expect(code(2, { where: '' })).toBe('where_missing');
    expect(code(2, { exp: '' })).toBe('exp_missing');
    expect(code(2, { minutes: null })).toBe('minutes_missing');
    expect(code(2, { days: 0, where: '', exp: '', minutes: null })).toBeNull();
  });
  it('step 3: goal, then all 6 health-check answers (object or array)', () => {
    expect(code(3, { goal: '' })).toBe('goal_missing');
    const { screen: _none, ...noScreen } = valid();
    expect(validateSetupStep(3, noScreen)).toBe('screen_incomplete');
    expect(code(3, { screen: { 0: 'no', 1: 'no', 2: 'no', 3: 'no', 4: 'yes' } })).toBe('screen_incomplete');
    expect(code(3, { screen: ['no', 'no', null, 'no', 'no', 'no'] })).toBe('screen_incomplete');
    expect(code(3, { screen: ['no', 'yes', 'no', 'no', 'no', 'no'] })).toBeNull();
  });
  it('validateSetup reports the first failing step', () => {
    expect(validateSetup(valid())).toBeNull();
    expect(validateSetup(valid({ activity: '', goal: '' }))).toEqual({ step: 1, error: 'activity_missing' });
  });
});

describe('normaliseSetup', () => {
  it('rounds the typed values and computes targets', () => {
    const p = normaliseSetup(valid({ age: '30.4', unit: 'ft', ft: '5', inch: '7', weight: '80.26' }), TODAY);
    expect(p).toMatchObject({ age: 30, height_cm: 170.2, weight_kg: 80.3, created: TODAY, cleared: null });
    const t = calcTargets(toTargetsProfile(p));
    expect(p.targets).toEqual({ kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat });
    expect(p.screen).toEqual(['no', 'no', 'no', 'no', 'no', 'no']);
  });
  it('0 days: exp and minutes are null, where defaults to gym', () => {
    const p = normaliseSetup(valid({ days: 0, where: '', exp: 'new', minutes: 45 }), TODAY);
    expect(p).toMatchObject({ days: 0, exp: null, minutes: null, where: 'gym' });
    expect(normaliseSetup(valid({ days: 0, where: 'bodyweight' }), TODAY).where).toBe('bodyweight');
  });
  it('special is none unless female; pace defaults to moderate', () => {
    expect(normaliseSetup(valid({ special: 'pregnant' }), TODAY).special).toBe('none');
    expect(normaliseSetup(valid({ sex: 'female', special: 'pregnant' }), TODAY).special).toBe('pregnant');
    const { special: _s, pace: _p, ...rest } = valid({ sex: 'female' });
    expect(normaliseSetup(rest, TODAY)).toMatchObject({ special: 'none', pace: 'moderate' });
  });
  it('keeps created and cleared from the previous profile', () => {
    expect(normaliseSetup(valid(), TODAY, { created: '2026-01-02', cleared: '2026-02-03' })).toMatchObject({ created: '2026-01-02', cleared: '2026-02-03' });
    expect(normaliseSetup(valid(), TODAY, { created: null })).toMatchObject({ created: TODAY, cleared: null });
    expect(normaliseSetup(valid(), TODAY, null)).toMatchObject({ created: TODAY, cleared: null });
  });
  it('throws on incomplete answers', () => {
    expect(() => normaliseSetup(valid({ goal: '' }), TODAY)).toThrow('normaliseSetup: step 3: goal_missing');
  });
});

describe('setupSummary', () => {
  const profile = (more: Partial<SetupAnswers> = {}) => normaliseSetup(valid(more), TODAY);
  it('burn range is TDEE × 0.9 to × 1.1', () => {
    const s = setupSummary(profile());
    expect(s.burnLow).toBe(s.targets.tdee * 0.9);
    expect(s.burnHigh).toBe(s.targets.tdee * 1.1);
  });
  it('a deficit gives loss with the percent and kg a week', () => {
    const s = setupSummary(profile());
    expect(s.pace).toBe('loss');
    expect(s.deficitPct).toBe(Math.round(((s.targets.tdee - s.targets.kcal) / s.targets.tdee) * 100));
    expect(s.paceKg).toBe(Math.round(-s.targets.weekly * 10) / 10);
  });
  it('gain and maintain', () => {
    const g = setupSummary(profile({ goal: 'gain' }));
    expect(g.pace).toBe('gain');
    expect(g.paceKg).toBe(Math.round(g.targets.weekly * 10) / 10);
    expect(g.deficitPct).toBeLessThan(0);
    const m = setupSummary(profile({ goal: 'maintain' }));
    expect(m).toMatchObject({ pace: 'steady', paceKg: null });
  });
  it('notes in prototype order', () => {
    const notes = (p: SetupProfile): SetupNote[] => setupSummary(p).notes;
    expect(notes(profile({ goal: 'maintain' }))).toEqual([]);
    expect(notes(profile({ sex: 'female', special: 'pregnant', where: 'dumbbells', age: '65', screen: { ...allNo, 2: 'yes' } }))).toEqual([
      'special',
      'screen',
      'home_dumbbells',
      'older',
    ]);
    expect(notes(profile({ weight: '200', cm: '190', goal: 'lose', where: 'bodyweight' }))).toEqual(['home_bodyweight', 'capped']);
    expect(notes(profile({ sex: 'female', weight: '40', cm: '150', age: '80', activity: 'sitting', days: 0 }))).toEqual(['floored', 'older']);
  });
});

// ---- Differential tests: the prototype's own validateStep / su-apply / setupResultHtml, sliced from the HTML ----

const MESSAGE: Record<SetupError, string> = {
  sex_missing: 'Choose male or female for the calorie formula.',
  age_missing: 'Enter your age.',
  age_under_min: 'Plate & Bar is built for adults 18 and over.',
  age_over_max: 'Check your age.',
  height_ft_out_of_range: 'Enter your height in feet and inches, like 5 and 7.',
  height_cm_out_of_range: 'Enter your height in cm, like 170.',
  weight_out_of_range: 'Enter your weight in kg, like 72.5.',
  activity_missing: 'Pick the option closest to a typical weekday.',
  days_missing: 'Choose how many sessions you do a week.',
  where_missing: 'Choose where you train.',
  exp_missing: 'Choose your training experience.',
  minutes_missing: 'Choose a typical session length.',
  goal_missing: 'Choose your main goal.',
  screen_incomplete: 'Answer the health check questions.',
};

const NOTE_MARK: Record<SetupNote, (fmt: (n: number) => string, s: ReturnType<typeof setupSummary>) => string> = {
  special: () => 'During pregnancy or breastfeeding the app',
  floored: (fmt, s) => `Your target stops at ${fmt(s.targets.floor)} kcal`,
  screen: () => 'You answered yes to a health check question',
  home_dumbbells: () => 'Home plan: dumbbell versions',
  home_bodyweight: () => 'Home plan: bodyweight exercises',
  older: () => 'For 60 and over',
  capped: () => 'The deficit is capped at 750 kcal',
};

interface Case {
  protoP: ProtoP;
  v: Record<string, string>;
  unit: 'ft' | 'cm';
  answers: SetupAnswers;
  previous: { created: string; cleared?: string } | null;
}

function randomCase(r: () => number): Case {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const often = <T,>(good: readonly T[], bad: readonly T[], pGood = 0.9): T => (r() < pGood ? pick(good) : pick(bad));
  const dec = (lo: number, hi: number, dp: number) => (lo + r() * (hi - lo)).toFixed(dp);
  const sex = often(['male', 'female'] as const, [''] as const, 0.95);
  const special = pick(['none', 'none', 'pregnant', 'breastfeeding'] as const);
  const age = often([String(18 + Math.floor(r() * 73)), dec(17, 91, 1)], ['', 'abc', '0', '0.4', '-3', '17.5', '90.5', '30,5', String(Math.floor(r() * 120))], 0.85);
  const unit = pick(['ft', 'cm'] as const);
  const ft = often(['4', '5', '5', '6', '6', '7'], ['', '3', '8', '5.5', 'x']);
  const inch = often([String(Math.floor(r() * 12)), dec(0, 12, 1)], ['', '12', '13', '-1']);
  const cm = often([dec(140, 210, pick([0, 1, 2]))], ['', '119.96', '120', '230', '230.01', dec(100, 250, 1), '170,5']);
  const weight = often([dec(40, 160, pick([0, 1, 2]))], ['', '29.96', '30', '300', '300.04', dec(10, 320, 2), '72,55']);
  const activity = often(['sitting', 'light', 'feet', 'physical'] as const, [''] as const, 0.95);
  const days = often([0, 0, 1, 2, 3, 4, 5, 6, 7], [null]);
  const where = often(['gym', 'dumbbells', 'bodyweight'] as const, [undefined, ''] as const, 0.85);
  const exp = often(['new', 'some', 'exp'] as const, [undefined, ''] as const, 0.85);
  const minutes = often(SESSION_MINUTES, [null, 0], 0.9);
  const goal = often(['lose', 'recomp', 'maintain', 'gain'] as const, [''] as const, 0.95);
  const pace = pick(['gentle', 'moderate'] as const);
  let screen: Record<number, 'yes' | 'no'> | undefined;
  if (r() < 0.97) {
    screen = {};
    for (let i = 0; i < 6; i++) if (r() < 0.98) screen[i] = r() < 0.85 ? 'no' : 'yes';
  }
  const previous = pick([null, null, { created: '2026-01-02' }, { created: '2026-01-02', cleared: '2026-03-04' }]);

  // Prototype SU.p as startSetup builds it, then su-pick fills it (where/exp/screen only exist once picked).
  const protoP: ProtoP = { sex, age: '', height: 0, weight: 0, activity, days, minutes, goal, pace, special: sex === 'female' ? special : 'none' };
  if (where !== undefined) protoP.where = where;
  if (exp !== undefined) protoP.exp = exp;
  if (screen) protoP.screen = { ...screen };
  if (previous?.cleared) protoP.cleared = previous.cleared;
  const v = { age, weight, cm, ft, inch };
  const answers: SetupAnswers = {
    sex,
    special,
    age,
    unit,
    ft,
    inch,
    cm,
    weight,
    activity,
    days,
    minutes,
    goal,
    pace,
    ...(where !== undefined ? { where } : {}),
    ...(exp !== undefined ? { exp } : {}),
    // Half the cases pass the prototype's object, half the array the app holds.
    ...(screen ? { screen: r() < 0.5 ? screen : Array.from({ length: 6 }, (_, i) => screen[i] ?? null) } : {}),
  };
  return { protoP, v, unit, answers, previous };
}

/** The prototype's saved profile in contract names. The three mappings are the documented differences. */
function protoToContract(pp: ProtoP, settings: Record<string, unknown>): SetupProfile {
  const training = (pp.days as number) > 0;
  return {
    sex: pp.sex,
    age: pp.age,
    height_cm: pp.height,
    weight_kg: pp.weight,
    activity: pp.activity,
    where: pp.where || 'gym',
    days: pp.days,
    exp: training ? pp.exp : null,
    minutes: training ? pp.minutes : null,
    goal: pp.goal,
    pace: pp.pace,
    special: pp.special,
    screen: Array.from({ length: 6 }, (_, i) => (pp.screen as Record<number, string>)[i]),
    created: pp.created,
    cleared: pp.cleared ?? null,
    targets: { kcal: settings.kcal, protein_g: settings.protein, carbs_g: settings.carbs, fat_g: settings.fat },
  } as SetupProfile;
}

describe('differential: port vs prototype over random answer sets', () => {
  const N = 6000;
  const proto = loadSetup(TODAY);
  const r = rng(126);
  const cases = Array.from({ length: N }, () => randomCase(r));
  const stats = { errors: new Map<string, number>(), applied: 0, zeroDays: 0, zeroDaysStaleExp: 0, whereDefaulted: 0, notes: new Map<string, number>(), paces: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  it('validateSetupStep gives the prototype validateStep message for every step', () => {
    for (const c of cases) {
      for (let step = 0; step <= SETUP_STEPS; step++) {
        Object.assign(proto.SU, { p: structuredClone(c.protoP), v: { ...c.v }, unit: c.unit, step });
        const want = proto.validateStep();
        const got = validateSetupStep(step, c.answers);
        expect(got ? MESSAGE[got] : '').toBe(want);
        if (got) bump(stats.errors, got);
      }
    }
    // Every code is reached by the random answers.
    expect([...stats.errors.keys()].sort()).toEqual(Object.keys(MESSAGE).sort());
  });

  it('normaliseSetup saves what su-apply saves; setupSummary shows what setupResultHtml shows', () => {
    for (const c of cases) {
      if (validateSetup(c.answers)) continue;
      // Prototype: "Continue" through steps 0–3 (validateStep cleans SU.p), then "Use these targets".
      Object.assign(proto.SU, { p: structuredClone(c.protoP), v: { ...c.v }, unit: c.unit });
      for (let step = 0; step < SETUP_STEPS; step++) {
        proto.SU.step = step;
        expect(proto.validateStep()).toBe('');
      }
      proto.SU.step = 4;
      const html = proto.setupResultHtml();
      proto.S.settings = c.previous ? { profile: { ...c.previous } } : {};
      proto.S.weights.entries = {};
      proto.setupAction('su-apply', { dataset: {} });
      const pp = proto.S.settings.profile as ProtoP;

      const got = normaliseSetup(c.answers, TODAY, c.previous);
      expect(got).toEqual(protoToContract(pp, proto.S.settings));
      stats.applied++;
      if (pp.days === 0) {
        stats.zeroDays++;
        expect(pp.minutes).toBe(0); // the prototype stores 0; the contract null
        if (pp.exp) stats.zeroDaysStaleExp++;
      }
      if (!pp.where) stats.whereDefaulted++;

      const s = setupSummary(got);
      const { fmt } = proto;
      expect(html).toContain(`You burn about ${fmt(s.targets.tdee)} kcal a day`);
      expect(html).toContain(`Likely range ${fmt(s.burnLow)}–${fmt(s.burnHigh)}.`);
      if (s.pace === 'loss') expect(html).toContain(`That’s ${s.deficitPct}% below your burn, about ${s.paceKg} kg of weight loss a week`);
      else if (s.pace === 'gain') expect(html).toContain(`That’s a small surplus, about ${s.paceKg} kg of gain a week.`);
      else expect(html).toContain('That matches your burn, so your weight should hold steady.');
      if (s.targets.adj < 0) expect(html).toContain(`A ${s.deficitPct}% deficit loses fat`);
      bump(stats.paces, s.pace);
      const shown = (Object.keys(NOTE_MARK) as SetupNote[])
        .map((n) => ({ n, at: html.indexOf(NOTE_MARK[n](fmt, s)) }))
        .filter((x) => x.at >= 0)
        .sort((a, b) => a.at - b.at)
        .map((x) => x.n);
      expect(s.notes).toEqual(shown);
      for (const n of s.notes) bump(stats.notes, n);
    }
    // The random answers reach every branch that matters.
    expect(stats.applied).toBeGreaterThan(1000);
    expect(stats.zeroDays).toBeGreaterThan(100);
    expect(stats.zeroDaysStaleExp).toBeGreaterThan(50);
    expect(stats.whereDefaulted).toBeGreaterThan(10);
    expect([...stats.paces.keys()].sort()).toEqual(['gain', 'loss', 'steady']);
    expect([...stats.notes.keys()].sort()).toEqual(Object.keys(NOTE_MARK).sort());
  });
});
