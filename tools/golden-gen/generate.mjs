// Builds every docs/spec/golden/*.json file from the prototype's own code and the case list in cases.mjs.
// Pure: returns { fileName: text }; cli.mjs writes or compares. No clock, no randomness, no network.
import * as C from './cases.mjs';
import { load } from './prototype.mjs';

// Same layout as the committed files: JSON with one-space indent and no trailing newline.
export const serialize = (v) => JSON.stringify(v, null, 1);

// Names loaded straight from the prototype, in file order where one depends on another.
const TABLES = ['TG', 'TAGS', 'CARDS', 'LIB', 'LADDERS', 'AWAY', 'EX_META', 'DEFAULT_STEP'];

const num = (v) => (Object.is(v, -0) ? 0 : v);

// A sandbox with the plan engine's functions and a fake `S`; the same pieces core's tests cut out of the HTML.
// Exclusions, per-lift history, clearance and the lab hold are stubbed off, as in core's test harness.
function planSandbox(html) {
  const pre = [
    'const S = { date:"", settings:{}, sessions:{ entries:{} }, lifts:{}, day:{ workout:{} } };',
    'const ruleState = () => { const X = S.settings; X.excl = X.excl || []; X.repl = X.repl || {}; return X; };',
    'const isExcluded = n => (S.settings.excl || []).includes(n);',
    'const activeRules = () => [], ruleMatches = () => false, candidates = () => [];',
    'const lastFor = () => null, needsClearance = () => false, labHoldOn = () => false;',
    'const whereNow = () => S.day.workout.where || (S.settings.profile && S.settings.profile.where) || "gym";',
  ].join('\n');
  const names = [
    'pad', 'ymd', 'parseYmd', 'addDays', ...TABLES, 'ORDER', 'TEMPLATES', 'adjState', 'mondayOf', 'daysBetween', 'sessionDates',
    'lastSession', 'inRange', 'planned', 'SPLITS', 'splitFor', 'planList', 'dayTemplate', 'exerciseCap', 'setsFor', 'COMPOUND',
    'trimSession', 'older', 'PUSH_M', 'muscleAllowed', 'focusList', 'isFocus', 'focusPick', 'applyFocus', 'mapForWhere',
    'homeName', 'SCOPE_RANK', 'resolveName', 'resolveSession', 'newExercise',
  ];
  return load(html, names, { pre });
}

export function exercisesFixture(html) {
  const get = load(html, TABLES);
  return { tags: get('TAGS'), ladders: get('LADDERS'), awayMap_dumbbells_bodyweight: get('AWAY'), cards: get('CARDS'), library: get('LIB') };
}

export function foodsFixture(html) {
  const get = load(html, ['FOODS', 'FIB', 'RAW', 'RAW_FIB', 'ALIAS']);
  return {
    foods: get('FOODS').map(([name, unit, kcal, protein, carbs, fat]) => ({ name, unit, kcal, protein, carbs, fat })),
    fibreAndAddedSugarPerServing: get('FIB'),
    raw100g: get('RAW'),
    rawFibre100g: get('RAW_FIB'),
    aliases: get('ALIAS'),
    notes: C.FOODS_NOTES,
  };
}

export function planFixture(html) {
  const get = planSandbox(html);
  const plans = C.PLAN_DAYS.map((days) => {
    get(`S.settings.profile = ${JSON.stringify({ days })}`);
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = get(`addDays(${JSON.stringify(C.WEEK_START)}, ${i})`);
      return { date, template: get(`planned(${JSON.stringify(date)})`) };
    });
    const exerciseCapByMinutes = C.PLAN_MINUTES.map((minutes) => {
      get(`S.settings.profile = ${JSON.stringify({ days, minutes })}`);
      return { minutes, cap: get('exerciseCap()') };
    });
    return { days, week, exerciseCapByMinutes };
  });
  return { templates: get('TEMPLATES'), splits: get('SPLITS'), plans };
}

// The exercises a session holds after the home mapping, exclusions, trim to the exercise cap and focus pick.
// (The check-in "short session" cut and set counts come after this in buildSession and are not recorded.)
export function sessionsFixture(html) {
  const get = planSandbox(html);
  const out = {};
  for (const where of C.SESSION_WHERE) {
    for (const t of C.SESSION_TEMPLATES) {
      for (const focus of C.SESSION_FOCUS) {
        const setup = { ...C.SESSION_PROFILE, where };
        get(`S.sessions.entries = {}; S.settings = { profile: ${JSON.stringify(setup)}, focus: ${JSON.stringify(focus ? [focus] : [])} }`);
        const w = JSON.stringify(where), tt = JSON.stringify(t);
        const items = get(`applyFocus(trimSession(resolveSession(mapForWhere([...TEMPLATES[${tt}]], ${w}), ${w}), ${tt}), ${tt}, ${w})`);
        out[`${where}|${t}${focus ? `|focus=${focus}` : ''}`] = items.map((x) => x.name);
      }
    }
  }
  return out;
}

export function progressionFixture(html) {
  const get = load(html, ['num', 'r1', 'pad', 'parseYmd', 'EX_META', 'DEFAULT_STEP', 'older', 'RATES', 'exInfo', 'noLoad', 'repWord', 'snap', 'harder', 'easier', 'kgLabel', 'kgLabelShort', 'lastFor', 'prevOf', 'suggestBase'], {
    pre: `const S = { date:${JSON.stringify(C.TODAY)}, lifts:{}, settings:{}, day:{ workout:{ exercises:[] } } }; const whereNow = () => 'gym';`,
  });
  const cases = C.PROGRESSION.map((input) => {
    get(`S.lifts = { [${JSON.stringify(input.name)}]: ${JSON.stringify(input.last)} }`);
    const s = get(`suggestBase({ name: ${JSON.stringify(input.name)} })`);
    return { input, output: { mode: s.mode, weight: s.w, reps: s.reps, text: s.text } };
  });
  return { exerciseMeta: get('EX_META'), defaultStep: get('DEFAULT_STEP'), cases };
}

// Stored rounding (PROTOTYPE_SPEC section 1): whole kcal for tdee, bmr, movement, training and digestion (Math.round, the
// prototype's `fmt`); kcal, protein, carbs and fat come out rounded from calcTargets; refWeight whole; weeklyKg to 2 decimals;
// negative zero stored as 0.
export function targetsFixture(html) {
  const get = load(html, ['num', 'ACTIVITY', 'PACE', 'TRAIN_NET_MET', 'bmrOf', 'calcTargets']);
  return C.TARGETS.map((input) => {
    const t = get(`calcTargets(${JSON.stringify(input)})`);
    return {
      input,
      output: {
        tdee: Math.round(t.tdee), bmr: Math.round(t.bmr), movement: Math.round(t.movement), training: Math.round(t.training),
        digestion: Math.round(t.digestion), kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat,
        floored: t.floored, capped: t.capped, refWeight: Math.round(t.refW), weeklyKg: num(Math.round(t.weekly * 100) / 100),
      },
    };
  });
}

// navyBodyFat stored to 1 decimal; water, fibre and workout burn come out whole from the prototype.
export function formulasFixture(html) {
  const get = load(html, ['num', 'r1', 'navyBF', 'waterTarget', 'fibreTarget', 'workoutBurn', 'latestWeight'], {
    pre: [
      'const S = { date:"", settings:{}, weights:{ entries:{} }, measures:{ entries:{} }, day:{ workout:{ exercises:[] } } };',
      'const measureAt = (key) => S.measures[key] === undefined ? null : { v: S.measures[key] };',
      'const kcalTarget = () => S.kcal; const planned = () => S.planned;',
    ].join('\n'),
  });
  // `planned` and `kcalTarget` are stubbed: a rest day has no planned session, a training day has one.
  const navyBodyFat = {};
  for (const n of C.NAVY) {
    get(`S.settings.profile = ${JSON.stringify({ sex: n.sex, height: n.height })}; S.measures = ${JSON.stringify({ waist: n.waist, neck: n.neck, hips: n.hips })}`);
    navyBodyFat[n.key] = Math.round(get('navyBF("")') * 10) / 10;
  }
  get(`S.weights.entries = { '2026-10-01': ${C.WEIGHT_KG} }; S.date = '2026-10-07'`);
  get('S.planned = null');
  const rest = get('waterTarget()').ml;
  get('S.planned = "Push A"');
  const train = get('waterTarget()').ml;
  get(`S.kcal = ${C.KCAL_TARGET}`);
  const burn = get(`workoutBurn({ cardio: ${C.WORKOUT.cardio}, exercises: [{ sets: ${JSON.stringify(C.WORKOUT.setTimes.map((t) => ({ done: true, t })))} }] }, ${C.WORKOUT.kg})`);
  return {
    navyBodyFat,
    water: { [`kg${C.WEIGHT_KG}_restDay_ml`]: rest, [`kg${C.WEIGHT_KG}_trainingDay_ml`]: train },
    fibreTarget: { [`kcal${C.KCAL_TARGET}`]: get('fibreTarget()') },
    workoutBurn: burn,
    e1rmScore: C.E1RM_SCORE,
  };
}

export const FIXTURES = {
  'exercises.json': exercisesFixture,
  'foods.json': foodsFixture,
  'formulas.json': formulasFixture,
  'plan.json': planFixture,
  'progression.json': progressionFixture,
  'sessions.json': sessionsFixture,
  'targets.json': targetsFixture,
};

export function generateAll(html) {
  return Object.fromEntries(Object.entries(FIXTURES).map(([file, fn]) => [file, serialize(fn(html))]));
}
