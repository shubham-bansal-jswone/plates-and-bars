import content from '../../../content/foods.json';
import {
  dayComplete,
  fibreTarget,
  fruitVegServings,
  logTotals,
  quantityFromGrams,
  searchFoods,
  showAddedSugar,
  unitGrams,
  FRUIT_VEG_TARGET,
  kcalTarget,
  DEFAULT_KCAL_TARGET,
  planFlex,
  flexToast,
  undoFlex,
  FLEX_FLOOR_DEFAULT,
  stepServings,
  SERVINGS_MIN,
  SERVINGS_MAX,
  SERVINGS_STEP,
  highProtein,
  customFood,
  saveMyFood,
  MY_FOODS_MAX,
  FOOD_NAME_MAX,
  userFoodFacts,
  calcTargets,
  toTargetsProfile,
  type KcalTargetProfile,
  type FlexEntry,
  type PlanFlexInput,
  type PlanFlexResult,
  type UserFoodFields,
  type FoodFacts,
  type FoodLogFacts,
  type GramsFood,
  type SearchableFood,
} from '../src/index';
import { loadGolden } from './helpers';
import { loadFood, type ProtoMeal, type ProtoMyFood } from './prototype-food';
import { rng } from './prototype-plan';

interface GoldenFoods {
  foods: { name: string; unit: string; kcal: number; protein: number; carbs: number; fat: number }[];
  fibreAndAddedSugarPerServing: Record<string, [number, number]>;
  aliases: Record<string, string>;
}
type Food = SearchableFood & GramsFood & FoodFacts & { serving: { label: string; grams: number | null }; per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } };

const golden = loadGolden<GoldenFoods>('foods');
const proto = loadFood();
const foods: Food[] = content.foods;
const RUNS = 4000;

/** The prototype's tables as content-shaped foods (FOODS rows, then FIB-only names such as eat-out "Cola (330 ml)"). */
const protoCatalog: Food[] = [
  ...proto.FOODS.map(([name, unit, kcal, p, c, f]) => ({ name, unit, kcal, p, c, f })),
  ...Object.keys(proto.FIB)
    .filter((n) => !proto.FOODS.some((r) => r[0] === n))
    .map((name) => ({ name, unit: '1 serving', kcal: 0, p: 0, c: 0, f: 0 })),
].map((r) => ({
  name: r.name,
  aliases: proto.ALIAS[r.name]?.split(' ') ?? [],
  serving: { label: r.unit, grams: unitGrams(r.unit) || null },
  per_serving: { kcal: r.kcal, protein_g: r.p, carbs_g: r.c, fat_g: r.f, fibre_g: proto.FIB[r.name]?.[0] ?? null, added_sugar_g: proto.FIB[r.name]?.[1] ?? null },
  fruit_veg_servings: proto.PRODUCE[r.name] ?? 0,
}));

const userFood = (m: ProtoMyFood): Food => ({
  name: m.name,
  serving: { label: m.unit, grams: unitGrams(m.unit) || null },
  per_serving: { kcal: m.kcal, protein_g: m.p, carbs_g: m.c, fat_g: m.f, fibre_g: m.fib ?? null, added_sugar_g: m.sug ?? null },
  fruit_veg_servings: m.veg ?? null,
});
const toLog = (m: ProtoMeal): FoodLogFacts => ({ name: m.name, qty: m.qty, kcal: m.kcal, protein_g: m.p, carbs_g: m.c, fat_g: m.f, deleted_at: null });
const logOf = (f: Food, qty = 1): FoodLogFacts => ({
  name: f.name,
  qty,
  kcal: f.per_serving.kcal,
  protein_g: f.per_serving.protein_g,
  carbs_g: f.per_serving.carbs_g,
  fat_g: f.per_serving.fat_g,
});
const byName = (n: string): Food => {
  const f = foods.find((x) => x.name === n);
  if (!f) throw new Error(n);
  return f;
};

// ---------- random inputs ----------
const NEW_NAMES = ['Office thali', 'Protein bar', 'Mom’s kadhi', 'Veg sandwich', 'Masala oats', 'Chicken roll', 'Lassi', 'Khichdi bowl'];
const UNITS = ['1 serving', '1 plate', '200 g', '1 bowl (250 g)', '12g', '1 cup (240 ml)', '1.5 g scoop', '30 gm', '45 g dry'];
const pickOf = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const maybe = <T>(r: () => number, p: number, v: () => T): T | undefined => (r() < p ? v() : undefined);
const amount = (r: () => number) => pickOf(r, [0, 0.5, 1, 1.5, 2, 3, r() * 400, Math.round(r() * 1000) / 10]);

function randomMyFoods(r: () => number, sharedNames: boolean): ProtoMyFood[] {
  const pool = sharedNames ? [...NEW_NAMES, ...protoCatalog.map((f) => f.name)] : NEW_NAMES;
  const names = [...new Set(Array.from({ length: Math.floor(r() * 5) }, () => pickOf(r, pool)))];
  return names.map((name) => {
    const m: ProtoMyFood = { name, unit: pickOf(r, UNITS), kcal: Math.round(r() * 600), p: amount(r) / 10, c: amount(r) / 5, f: amount(r) / 20 };
    const fib = maybe(r, 0.6, () => Math.round(r() * 100) / 10);
    if (fib !== undefined) m.fib = fib;
    const sug = maybe(r, 0.5, () => Math.round(r() * 300) / 10);
    if (sug !== undefined) m.sug = sug;
    const veg = maybe(r, 0.4, () => pickOf(r, [0, 0.5, 1, 2]));
    if (veg !== undefined) m.veg = veg;
    return m;
  });
}

function randomMeals(r: () => number, my: ProtoMyFood[]): ProtoMeal[] {
  const names = [...protoCatalog.map((f) => f.name), ...my.map((m) => m.name), ...NEW_NAMES, 'Dal (1 katori)', 'Beer (330 ml)', 'dal'];
  return Array.from({ length: Math.floor(r() * 8) }, () => {
    const name = pickOf(r, names);
    const f = protoCatalog.find((x) => x.name === name);
    const qty = pickOf(r, [0.5, 1, 1, 2, 1.5, 3, 0, Math.round(r() * 50) / 10, r() * 4]);
    return f && r() < 0.8
      ? { name, qty, kcal: f.per_serving.kcal, p: f.per_serving.protein_g, c: f.per_serving.carbs_g, f: f.per_serving.fat_g }
      : { name, qty, kcal: Math.round(r() * 900), p: amount(r) / 10, c: amount(r) / 5, f: amount(r) / 20 };
  });
}

function randomQuery(r: () => number): string {
  const f = pickOf(r, protoCatalog);
  const src = r() < 0.5 ? f.name : (f.aliases ?? []).join(' ') || f.name;
  const a = Math.floor(r() * src.length);
  const sub = src.slice(a, a + 1 + Math.floor(r() * 8));
  return pickOf(r, [
    sub,
    sub.toUpperCase(),
    `  ${sub} `,
    '',
    '   ',
    pickOf(r, ['chawal', 'daru', 'ALCOHOL', 'a', 'roti', 'egg', 'murg', 'dal', 'xyz', 'fulka rotli', 'n c', ' Paneer ', 'thali', 'oats', ',', '(']),
    String.fromCharCode(97 + Math.floor(r() * 26)),
  ]);
}

// ---------- golden foods ----------
describe('golden foods.json against the prototype tables and content/foods.json', () => {
  it('the fixture is the prototype’s FOODS, FIB and ALIAS (harness check)', () => {
    expect(golden.foods.map((f) => [f.name, f.unit, f.kcal, f.protein, f.carbs, f.fat])).toEqual(proto.FOODS);
    expect(golden.fibreAndAddedSugarPerServing).toEqual(proto.FIB);
    expect(golden.aliases).toEqual(proto.ALIAS);
  });

  it('content matches the fixture for every content food, in fixture order', () => {
    const shared = protoCatalog.filter((p) => foods.some((f) => f.name === p.name));
    expect(foods.map((f) => f.name)).toEqual(shared.map((f) => f.name));
    for (const f of foods) {
      const g = golden.foods.find((x) => x.name === f.name);
      expect([f.serving.label, f.per_serving.kcal, f.per_serving.protein_g, f.per_serving.carbs_g, f.per_serving.fat_g]).toEqual([g?.unit, g?.kcal, g?.protein, g?.carbs, g?.fat]);
      expect([f.per_serving.fibre_g, f.per_serving.added_sugar_g]).toEqual(golden.fibreAndAddedSugarPerServing[f.name]);
      expect((f.aliases ?? []).join(' ')).toBe(golden.aliases[f.name] ?? '');
      expect(f.serving.grams).toBe(unitGrams(f.serving.label) || null);
      expect(f.fruit_veg_servings).toBe(proto.PRODUCE[f.name] ?? 0);
    }
  });

  it('PINNED QUIRK (#151): content lacks the prototype’s drinks and the eat-out "Cola (330 ml)" fibre row', () => {
    expect(protoCatalog.filter((p) => !foods.some((f) => f.name === p.name)).map((f) => f.name)).toEqual(['Beer', 'Whisky, rum or vodka', 'Wine', 'Cola (330 ml)']);
    // So a logged Cola from eating out counts 35 g added sugar in the prototype, and none with content.
    const cola: FoodLogFacts = { name: 'Cola (330 ml)', qty: 1, kcal: 140, protein_g: 0, carbs_g: 35, fat_g: 0 };
    expect(logTotals([cola], protoCatalog).added_sugar_g).toBe(35);
    expect(logTotals([cola], foods)).toMatchObject({ added_sugar_g: 0, withoutFibre: 1 });
  });

  it('one serving of each content food totals its golden values', () => {
    for (const f of foods) {
      const g = golden.foods.find((x) => x.name === f.name);
      const [fib, sug] = golden.fibreAndAddedSugarPerServing[f.name] ?? [];
      expect(logTotals([logOf(f)], foods)).toEqual({ kcal: g?.kcal, protein_g: g?.protein, carbs_g: g?.carbs, fat_g: g?.fat, fibre_g: fib, added_sugar_g: sug, withoutFibre: 0 });
    }
  });
});

// ---------- search ----------
describe('searchFoods', () => {
  it('matches name or alias, case-insensitive on the query, list order kept', () => {
    expect(searchFoods('chawal', foods).map((f) => f.name)).toEqual(['Rice, cooked']);
    expect(searchFoods('  ANDA ', foods).map((f) => f.name)).toEqual(['Egg, whole', 'Egg white']);
    expect(searchFoods('paneer', foods).map((f) => f.name)).toEqual(['Paneer', 'Paneer bhurji']);
    expect(searchFoods('', foods)).toHaveLength(foods.length);
    expect(searchFoods('zzz', foods)).toEqual([]);
  });
  it('PINNED QUIRK (#151): a query can span two aliases, since aliases are matched as one string', () => {
    expect(searchFoods('fulka rotli', foods).map((f) => f.name)).toEqual(['Roti / chapati']);
    expect(searchFoods('gh mu', foods).map((f) => f.name)).toEqual(['Chicken breast, cooked', 'Chicken curry']); // "murgh murg"
    expect(searchFoods('peg spirit', protoCatalog).map((f) => f.name)).toEqual(['Whisky, rum or vodka']);
  });
  it('user foods come first and have no aliases', () => {
    const mine = [{ name: 'Office thali' }];
    expect(searchFoods('thali', [...mine, ...foods])).toEqual(mine);
    expect(searchFoods('a', [...mine, ...foods])[0]).toBe(mine[0]);
  });
  it('PINNED QUIRK (#151): the prototype gives a user food the aliases of a shared food with the same name', () => {
    proto.S.settings.myFoods = [{ name: 'Dal', unit: '1 bowl', kcal: 200, p: 9, c: 30, f: 5 }];
    expect(proto.search('toor')).toEqual(['Dal', 'Dal']);
    expect(searchFoods('toor', [{ name: 'Dal' }, ...foods]).map((f) => f.name)).toEqual(['Dal']);
    proto.S.settings.myFoods = [];
  });
  it(`matches prototype foodListHtml over ${RUNS} random queries and user foods`, () => {
    const r = rng(146);
    for (let i = 0; i < RUNS; i++) {
      const my = randomMyFoods(r, false);
      proto.S.settings.myFoods = my;
      const q = randomQuery(r);
      expect([q, searchFoods(q, [...my.map(userFood), ...protoCatalog.slice(0, proto.FOODS.length)]).map((f) => f.name)]).toEqual([q, proto.search(q)]);
    }
    proto.S.settings.myFoods = [];
  });
});

// ---------- grams ----------
describe('unitGrams and quantityFromGrams', () => {
  it('reads the first whole number before "g"', () => {
    expect(unitGrams('1 katori (35 g dal)')).toBe(35);
    expect(unitGrams('100 g')).toBe(100);
    expect(unitGrams('12g')).toBe(12);
    expect(unitGrams('1 glass (250 ml)')).toBe(0);
    expect(unitGrams('30 gm')).toBe(0);
    expect(unitGrams('1.5 g scoop')).toBe(5); // PINNED QUIRK (#151): decimals lose their whole part
  });
  it('grams over the serving weight, to 0.1; the bracketed weight is the dry weight (#97)', () => {
    expect(quantityFromGrams(byName('Rice, cooked'), 75)).toEqual({ kind: 'grams', qty: 1.5 });
    expect(quantityFromGrams(byName('Paneer'), '150')).toEqual({ kind: 'grams', qty: 1.5 });
    expect(quantityFromGrams(byName('Paneer'), '12,5')).toEqual({ kind: 'grams', qty: 0.1 });
    expect(quantityFromGrams(byName('Dal'), 100)).toEqual({ kind: 'grams', qty: 2.9 });
  });
  it('no grams entered: servings; grams for a food without a gram weight: refused', () => {
    expect(quantityFromGrams(byName('Paneer'), '')).toEqual({ kind: 'servings' });
    expect(quantityFromGrams(byName('Paneer'), 0)).toEqual({ kind: 'servings' });
    expect(quantityFromGrams(byName('Paneer'), '-50')).toEqual({ kind: 'servings' });
    expect(quantityFromGrams(byName('Idli'), 50)).toEqual({ kind: 'not-in-grams' });
    expect(quantityFromGrams(byName('Idli'), 'abc')).toEqual({ kind: 'servings' });
  });
  it('grams that round to 0 servings are too small (#150: the prototype logs qty 0)', () => {
    expect(quantityFromGrams(byName('Paneer'), 4)).toEqual({ kind: 'too-small' });
    expect(quantityFromGrams(byName('Paneer'), 5)).toEqual({ kind: 'grams', qty: 0.1 });
    expect(proto.pick('Paneer', '4', 1)).toEqual({ qty: 0 });
  });
  it(`matches prototype case 'pick' over ${RUNS} random foods and inputs`, () => {
    const r = rng(97);
    for (let i = 0; i < RUNS; i++) {
      const my = randomMyFoods(r, false);
      proto.S.settings.myFoods = my;
      const all = [...my.map(userFood), ...protoCatalog.slice(0, proto.FOODS.length)];
      const f = pickOf(r, all);
      const g = pickOf(r, ['', '0', '-5', 'abc', '0,4', '1', '4', '15', '35', '49.95', '2,5', ' 120 ', String(Math.round(r() * 5000) / 10), String(r() * 1000)]);
      const serv = pickOf(r, [0.5, 1, 1.5, 2, 10]);
      const p = proto.pick(f.name, g, serv);
      // The one exception to the prototype: qty 0 from grams is `too-small` (#150).
      const want = 'err' in p ? { kind: 'not-in-grams' } : num(g) > 0 ? (p.qty === 0 ? { kind: 'too-small' } : { kind: 'grams', qty: p.qty }) : { kind: 'servings' };
      expect([f.name, g, quantityFromGrams(f, g)]).toEqual([f.name, g, want]);
      if (!('err' in p) && !(num(g) > 0)) expect(p.qty).toBe(serv);
    }
    proto.S.settings.myFoods = [];
  });
});

const num = (v: string): number => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// ---------- totals, fibre, fruit and veg, added sugar ----------
describe('logTotals, fruitVegServings, fibreTarget, showAddedSugar', () => {
  it('sums per-serving values × qty; fibre only from foods with fibre data', () => {
    const logs = [logOf(byName('Roti / chapati'), 2), logOf(byName('Dal')), { name: 'Office thali', qty: 1, kcal: 700, protein_g: 20, carbs_g: 90, fat_g: 25 }];
    expect(logTotals(logs, foods)).toEqual({ kcal: 2 * 102 + 161 + 700, protein_g: 8 + 7.8 + 20, carbs_g: 2 * 21.6 + 23.3 + 90, fat_g: 1.6 + 4.6 + 25, fibre_g: 2 * 3.2 + 5.5, added_sugar_g: 0, withoutFibre: 1 });
  });
  it('a user food with fibre data counts; a shared food of the same name wins', () => {
    const mine: FoodFacts = { name: 'Office thali', per_serving: { fibre_g: 9, added_sugar_g: null }, fruit_veg_servings: 1.5 };
    const thali = { name: 'Office thali', qty: 2, kcal: 700, protein_g: 20, carbs_g: 90, fat_g: 25 };
    expect(logTotals([thali], [...foods, mine])).toMatchObject({ fibre_g: 18, added_sugar_g: 0, withoutFibre: 0 });
    expect(fruitVegServings([thali], [...foods, mine])).toBe(3);
    const dal: FoodFacts = { name: 'Dal', per_serving: { fibre_g: 1, added_sugar_g: 7 }, fruit_veg_servings: 2 };
    expect(logTotals([logOf(byName('Dal'))], [...foods, dal]).fibre_g).toBe(5.5);
    expect(fruitVegServings([logOf(byName('Dal'))], [...foods, dal])).toBe(2); // shared Dal has 0, so the user's counts
  });
  it('deleted logs are left out', () => {
    const del = { ...logOf(byName('Banana'), 3), deleted_at: '2026-10-08T10:00:00Z' };
    expect(logTotals([del], foods)).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, added_sugar_g: 0, withoutFibre: 0 });
    expect(fruitVegServings([del, logOf(byName('Fruit bowl'), 1.5)], foods)).toBe(3);
  });
  it('fibre target: 15 g per 1,000 kcal, at least 25 g', () => {
    expect([fibreTarget(1500), fibreTarget(1700), fibreTarget(1699), fibreTarget(2500), fibreTarget(0)]).toEqual([25, 26, 25, 38, 25]);
  });
  it('added sugar shows at 10 g or more, unrounded; fruit and veg out of 5', () => {
    expect([showAddedSugar({ added_sugar_g: 9.99 }), showAddedSugar({ added_sugar_g: 10 })]).toEqual([false, true]);
    expect(showAddedSugar(logTotals([logOf(byName('Tea with milk & sugar'), 2)], foods))).toBe(true);
    expect(FRUIT_VEG_TARGET).toBe(5);
  });
  it('PINNED QUIRK (#151): the added-sugar check reads the unrounded value, so 9.6 g is hidden though it would show as 10', () => {
    const tea = { ...logOf(byName('Tea with milk & sugar')), qty: 1.92 };
    const t = logTotals([tea], foods);
    expect(t.added_sugar_g).toBeCloseTo(9.6, 10);
    expect(Math.round(t.added_sugar_g)).toBe(10);
    expect(showAddedSugar(t)).toBe(false);
    proto.S.day.meals = [{ name: tea.name, qty: tea.qty, kcal: tea.kcal, p: tea.protein_g, c: tea.carbs_g, f: tea.fat_g }];
    expect(proto.fibreHtml()).not.toContain('Added sugar');
    proto.S.day.meals = [];
  });
  it(`match prototype totals, fibreTotals and fibreHtml over ${RUNS} random days`, () => {
    const r = rng(25);
    for (let i = 0; i < RUNS; i++) {
      const my = randomMyFoods(r, true);
      const meals = randomMeals(r, my);
      const kt = pickOf(r, [1200, 1500, 1666, 1667, 1700, 2000, 2433, 3000, Math.round(r() * 4000), r() * 4000]);
      proto.S.settings.myFoods = my;
      proto.S.day.meals = meals;
      proto.setKcalTarget(kt);
      const cat = [...protoCatalog, ...my.map(userFood)];
      const logs = meals.map(toLog);
      const t = logTotals(logs, cat), pt = proto.totals(meals), pf = proto.fibreTotals(meals);
      const veg = fruitVegServings(logs, cat);
      expect(t).toEqual({ kcal: pt.kcal, protein_g: pt.p, carbs_g: pt.c, fat_g: pt.f, fibre_g: pf.fib, added_sugar_g: pf.sug, withoutFibre: pf.unknown });
      expect(veg).toBe(pf.veg);
      expect(fibreTarget(kt)).toBe(proto.fibreTarget());
      const html = proto.fibreHtml();
      if (meals.length) {
        expect(html).toContain(`<b>Fibre</b> ${Math.round(t.fibre_g).toLocaleString('en-IN')} of ${fibreTarget(kt)} g`);
        expect(html).toContain(`<b>Fruit & veg</b> ${Math.round(veg * 10) / 10} of ${FRUIT_VEG_TARGET} servings`);
        expect(html.includes('<b>Added sugar</b>')).toBe(showAddedSugar(t));
      } else expect(html).toBe('');
    }
    proto.S.settings.myFoods = [];
    proto.S.day.meals = [];
  });
});

// ---------- day complete ----------
describe('dayComplete', () => {
  const three = [logOf(byName('Dal'), 4), logOf(byName('Rice, cooked'), 3), logOf(byName('Paneer'), 1)]; // 644 + 546 + 280 = 1470
  it('the tick decides when set', () => {
    expect(dayComplete({ complete: true }, [], 2000)).toBe(true);
    expect(dayComplete({ complete: false }, three, 1000)).toBe(false);
  });
  it('untouched: 3 or more logs and at least 75% of the target', () => {
    expect(dayComplete({ complete: null }, three, 1960)).toBe(true); // 1470 = 75% of 1960
    expect(dayComplete(null, three, 1961)).toBe(false);
    expect(dayComplete(undefined, three.slice(0, 2), 1000)).toBe(false);
    expect(dayComplete({}, [...three.slice(0, 2), { ...three[2]!, deleted_at: '2026-10-08T10:00:00Z' }], 1000)).toBe(false);
  });
  const breakfast = [logOf(byName('Egg, whole'), 10), logOf(byName('Roti / chapati'), 4), logOf(byName('Toned milk'), 2)];
  it('PINNED QUIRK (#151): three items in one meal count as three meals', () => {
    expect(dayComplete({ complete: null }, breakfast, 1500)).toBe(true);
  });
  it(`matches prototype dayComplete over ${RUNS} random days`, () => {
    const r = rng(75);
    for (let i = 0; i < RUNS; i++) {
      const meals = randomMeals(r, []);
      const complete = pickOf(r, [true, false, undefined, null]);
      const kcal = pickOf(r, [1000, 1500, 2000, 2500, Math.round(r() * 3000)]);
      proto.S.settings.kcal = kcal;
      const d: { meals: ProtoMeal[]; complete?: boolean } = { meals };
      if (complete !== undefined) (d as { complete?: boolean | null }).complete = complete;
      expect(dayComplete({ complete }, meals.map(toLog), kcal)).toBe(proto.dayComplete(d));
    }
  });
});

// ---------- food screen support (#152) ----------
const ACTS = ['sitting', 'light', 'feet', 'physical'] as const;
const GOALS = ['lose', 'recomp', 'maintain', 'gain'] as const;
function randomProfile(r: () => number): KcalTargetProfile {
  const sex = pickOf(r, ['male', 'female'] as const);
  const days = Math.floor(r() * 8);
  return {
    sex,
    age: 18 + Math.floor(r() * 73),
    height_cm: Math.round((140 + r() * 60) * 10) / 10,
    weight_kg: Math.round((40 + r() * 110) * 10) / 10,
    activity: pickOf(r, ACTS),
    days,
    minutes: days ? pickOf(r, [30, 45, 60, 75, 90] as const) : null,
    goal: pickOf(r, GOALS),
    pace: pickOf(r, ['gentle', 'moderate'] as const),
    special: sex === 'female' ? pickOf(r, ['none', 'pregnant', 'breastfeeding'] as const) : 'none',
    targets: { kcal: Math.round((1200 + r() * 2400) / 10) * 10 },
  };
}

describe('kcalTarget', () => {
  const p: KcalTargetProfile = { sex: 'male', age: 30, height_cm: 175, weight_kg: 80, activity: 'sitting', days: 3, minutes: 60, goal: 'lose', pace: 'moderate', special: 'none', targets: { kcal: 2000 } };
  const flex = [
    { id: 'a', date: '2026-10-08', kcal_delta: 500 },
    { id: 'a', date: '2026-10-09', kcal_delta: -167 },
    { id: 'b', date: '2026-10-09', kcal_delta: -100 },
  ];
  it('the saved target plus that day’s flex entries', () => {
    expect(kcalTarget('2026-10-08', { flex }, p)).toBe(2500);
    expect(kcalTarget('2026-10-09', { flex }, p)).toBe(1733);
    expect(kcalTarget('2026-10-10', { flex }, p)).toBe(2000);
    expect(kcalTarget('2026-10-10', { flex: null }, p)).toBe(2000);
    expect(kcalTarget('2026-10-08', { flex }, null)).toBe(DEFAULT_KCAL_TARGET + 500);
  });
  it('lab hold: at least maintenance to the nearest 10, flex ignored; no profile: the flex rule', () => {
    const tdee = Math.round(calcTargets(toTargetsProfile(p)).tdee / 10) * 10;
    expect(tdee).toBe(2390); // maintenance, above the 2000 target; the +500 flex for the day is ignored
    expect(kcalTarget('2026-10-08', { flex, labHold: true }, p)).toBe(tdee);
    expect(kcalTarget('2026-10-08', { flex, labHold: true }, { ...p, targets: { kcal: 4000 } })).toBe(4000);
    expect(kcalTarget('2026-10-08', { flex, labHold: true }, null)).toBe(DEFAULT_KCAL_TARGET + 500);
  });
  it(`matches prototype kcalTarget over ${RUNS} random profiles, flex days and lab holds`, () => {
    const r = rng(2922);
    const dates = ['2026-10-07', '2026-10-08', '2026-10-09'];
    for (let i = 0; i < RUNS; i++) {
      const prof = r() < 0.15 ? null : randomProfile(r);
      const fl = Array.from({ length: Math.floor(r() * 5) }, () => ({ id: 'x', date: pickOf(r, dates), kcal_delta: pickOf(r, [300, 500, 800, -100, -167, -250]) }));
      const hold = pickOf(r, [true, false, undefined]);
      const date = pickOf(r, dates);
      const settings = {
        kcal: prof ? prof.targets.kcal : DEFAULT_KCAL_TARGET,
        profile: prof && { ...toTargetsProfile(prof) },
        flex: fl.map((x) => ({ id: x.id, date: x.date, d: x.kcal_delta })),
        labHold: hold === undefined ? undefined : { on: hold },
      };
      expect(kcalTarget(date, { flex: fl, labHold: hold }, prof)).toBe(proto.realKcalTarget(date, settings));
    }
  });
});

describe('planFlex and undoFlex', () => {
  // Decided in #167: no day goes below the floor. The cases below are worked by hand (the golden generator
  // is #99); each also runs through the prototype's own planFlex. The differential test covers the rest.
  const base: KcalTargetProfile = { sex: 'female', age: 30, height_cm: 165, weight_kg: 70, activity: 'sitting', days: 3, minutes: 60, goal: 'lose', pace: 'moderate', special: 'none', targets: { kcal: 1800 } };
  const male: KcalTargetProfile = { ...base, sex: 'male' };
  const holdMan: KcalTargetProfile = { sex: 'male', age: 30, height_cm: 175, weight_kg: 80, activity: 'sitting', days: 3, minutes: 60, goal: 'lose', pace: 'moderate', special: 'none', targets: { kcal: 2000 } };
  const at = { date: '2026-10-08', today: '2026-10-08', id: 'p1', flex: null };
  const cuts = (f: FlexEntry[]) => f.filter((x) => x.kcal_delta < 0).map((x) => [x.date, x.kcal_delta]);
  const protoRun = (input: PlanFlexInput, prof: KcalTargetProfile | null) =>
    proto.planFlex(
      input.extra,
      {
        kcal: prof ? prof.targets.kcal : DEFAULT_KCAL_TARGET,
        profile: prof && { ...toTargetsProfile(prof) },
        flex: input.flex ? input.flex.map((x) => ({ id: x.id, date: x.date, d: x.kcal_delta })) : input.flex === null ? null : undefined,
        labHold: input.labHold === undefined ? undefined : { on: input.labHold },
      },
      input.date,
      input.today,
      input.id,
    );

  interface FlexCase {
    name: string;
    profile: KcalTargetProfile | null;
    input: Partial<PlanFlexInput> & { extra: number };
    cuts: [string, number][];
    result: Omit<PlanFlexResult, 'flex'>;
    toast: string;
    /** The lowest target on a cut day afterwards (lab hold off), checked against the floor. */
    lowest?: number;
  }
  const other800: FlexEntry[] = [
    { id: 'p0', date: '2026-10-08', kcal_delta: 800 },
    { id: 'p0', date: '2026-10-09', kcal_delta: -260 },
    { id: 'p0', date: '2026-10-10', kcal_delta: -260 },
    { id: 'p0', date: '2026-10-11', kcal_delta: -260 },
  ];
  const cases: FlexCase[] = [
    {
      // rule 2: 800 / 3 = 266.7 rounds down to 260, so the cuts total 780, never 810
      name: 'rounding: no profile, +800 over 3 days of 260',
      profile: null,
      input: { extra: 800 },
      cuts: [['2026-10-09', -260], ['2026-10-10', -260], ['2026-10-11', -260]],
      result: { spread: 3, per: 260, even: true, leftover: 0 },
      toast: 'Today +800 kcal; the next 3 days 260 lower',
      lowest: 1640,
    },
    {
      // rule 2: room 1367 - 1200 = 167 rounds down to 160; 500 / 3 = 166.7 rounds down to 160: the day is 1207, not 1197
      name: 'rounding: target 1367, +500 stays above the floor',
      profile: { ...base, targets: { kcal: 1367 } },
      input: { extra: 500 },
      cuts: [['2026-10-09', -160], ['2026-10-10', -160], ['2026-10-11', -160]],
      result: { spread: 3, per: 160, even: true, leftover: 0 },
      toast: 'Today +500 kcal; the next 3 days 160 lower',
      lowest: 1207,
    },
    {
      // spread grows: male floor 1500, room 200; 800/3 = 260 > 200, 800/4 = 200 fits
      name: 'spread: male 1700, +800 over 4 days of 200',
      profile: { ...male, targets: { kcal: 1700 } },
      input: { extra: 800 },
      cuts: [['2026-10-09', -200], ['2026-10-10', -200], ['2026-10-11', -200], ['2026-10-12', -200]],
      result: { spread: 4, per: 200, even: true, leftover: 0 },
      toast: 'Today +800 kcal; the next 4 days 200 lower',
      lowest: 1500,
    },
    {
      // rules 1 and 3: room 100 a day; even 6 days (130) does not fit, so each day takes 100 and 200 is left over
      name: 'leftover: target 1300, +800 fills 6 days to the floor',
      profile: { ...base, targets: { kcal: 1300 } },
      input: { extra: 800 },
      cuts: [['2026-10-09', -100], ['2026-10-10', -100], ['2026-10-11', -100], ['2026-10-12', -100], ['2026-10-13', -100], ['2026-10-14', -100]],
      result: { spread: 6, per: 100, even: true, leftover: 200 },
      toast: 'Today +800 kcal; the next 6 days 100 lower; 200 kcal could not be spread without going below your minimum',
      lowest: 1200,
    },
    {
      // rule 3: target already at the floor, no room at all; today still gets the extra
      name: 'leftover: target 1200, +300 cannot be spread at all',
      profile: { ...base, targets: { kcal: 1200 } },
      input: { extra: 300 },
      cuts: [],
      result: { spread: 6, per: 0, even: true, leftover: 300 },
      toast: 'Today +300 kcal; 300 kcal could not be spread without going below your minimum',
    },
    {
      // rule 1: an earlier +800 plan left days 9-11 at 1240 (room 40); days 12-14 have room 300.
      // No even split fits, so the days fill level: 3 x 40 + 3 x 220 = 780 (230 would be 810 > 800).
      name: 'other plans: a second +800 at target 1500 keeps every day at or above 1200',
      profile: { ...base, targets: { kcal: 1500 } },
      input: { extra: 800, id: 'p2', flex: other800 },
      cuts: [
        ['2026-10-09', -260], ['2026-10-10', -260], ['2026-10-11', -260],
        ['2026-10-09', -40], ['2026-10-10', -40], ['2026-10-11', -40], ['2026-10-12', -220], ['2026-10-13', -220], ['2026-10-14', -220],
      ],
      result: { spread: 6, per: 220, even: false, leftover: 0 },
      toast: 'Today +800 kcal; the next 6 days up to 220 lower',
      lowest: 1200,
    },
    {
      // rule 1, lab hold: kcalTarget is 2390 (maintenance) on every day while the hold is on, but day 9 has
      // another plan's -400, so its room is min(2390, 1600) - 1500 = 100. Level fill: 100 + 5 x 140 = 800.
      name: 'lab hold: the cut is checked against the target the day returns to when the hold ends',
      profile: holdMan,
      input: { extra: 800, labHold: true, flex: [{ id: 'p0', date: '2026-10-09', kcal_delta: -400 }] },
      cuts: [['2026-10-09', -400], ['2026-10-09', -100], ['2026-10-10', -140], ['2026-10-11', -140], ['2026-10-12', -140], ['2026-10-13', -140], ['2026-10-14', -140]],
      result: { spread: 6, per: 140, even: false, leftover: 0 },
      toast: 'Today +800 kcal; the next 6 days up to 140 lower',
      lowest: 1500,
    },
    {
      // rounding down: under 30 kcal there is nothing to cut and no entry is added
      name: 'tiny extra: +20 adds only today’s entry',
      profile: null,
      input: { extra: 20 },
      cuts: [],
      result: { spread: 3, per: 0, even: true, leftover: 0 },
      toast: 'Today +20 kcal',
    },
  ];

  it.each(cases)('hand-worked case: $name', (c) => {
    const input: PlanFlexInput = { ...at, ...c.input };
    const out = planFlex(input, c.profile);
    const { flex, ...result } = out;
    expect(result).toEqual(c.result);
    expect(cuts(flex)).toEqual(c.cuts);
    expect(flex.filter((x) => x.id === input.id && x.kcal_delta > 0)).toEqual([{ id: input.id, date: '2026-10-08', kcal_delta: c.input.extra }]);
    expect(flexToast(c.input.extra, out)).toBe(c.toast);
    const want = protoRun(input, c.profile);
    expect(flex).toEqual(want.flex.map((x) => ({ id: x.id, date: x.date, kcal_delta: x.d })));
    expect(want.toast).toBe(c.toast);
    const newCut = flex.filter((x) => x.id === input.id && x.kcal_delta < 0).map((x) => kcalTarget(x.date, { flex }, c.profile));
    if (c.lowest !== undefined) expect(Math.min(...newCut)).toBe(c.lowest);
    expect(-flex.filter((x) => x.id === input.id && x.kcal_delta < 0).reduce((a, x) => a + x.kcal_delta, 0) + c.result.leftover).toBeLessThanOrEqual(c.input.extra);
  });

  it('no profile: +500 today, 160 off each of the next 3 days, one id on every entry', () => {
    const out = planFlex({ ...at, extra: 500 }, null);
    expect(out).toEqual({
      spread: 3,
      per: 160,
      even: true,
      leftover: 0,
      flex: [
        { id: 'p1', date: '2026-10-08', kcal_delta: 500 },
        { id: 'p1', date: '2026-10-09', kcal_delta: -160 },
        { id: 'p1', date: '2026-10-10', kcal_delta: -160 },
        { id: 'p1', date: '2026-10-11', kcal_delta: -160 },
      ],
    });
    expect(FLEX_FLOOR_DEFAULT).toBe(1200);
    expect(kcalTarget('2026-10-08', { flex: out.flex }, null)).toBe(DEFAULT_KCAL_TARGET + 500);
    expect(kcalTarget('2026-10-09', { flex: out.flex }, null)).toBe(DEFAULT_KCAL_TARGET - 160);
  });

  it('spreads over more days while the even cut does not fit', () => {
    // female floor 1200, room 300: 300/3 = 100 and 800/3 = 260 fit
    expect(planFlex({ ...at, extra: 300 }, { ...base, targets: { kcal: 1500 } })).toMatchObject({ spread: 3, per: 100 });
    expect(planFlex({ ...at, extra: 800 }, { ...base, targets: { kcal: 1500 } })).toMatchObject({ spread: 3, per: 260 });
    // male floor 1500: 1800 has room 300 -> 3 days; 1730 has room 230: 260 no, 200 fits -> 4 days
    expect(planFlex({ ...at, extra: 800 }, { ...male, targets: { kcal: 1800 } })).toMatchObject({ spread: 3, per: 260 });
    expect(planFlex({ ...at, extra: 800 }, { ...male, targets: { kcal: 1730 } })).toMatchObject({ spread: 4, per: 200 });
    // room 170: 5 days of 160; room 140: 6 days of 130
    expect(planFlex({ ...at, extra: 800 }, { ...male, targets: { kcal: 1670 } })).toMatchObject({ spread: 5, per: 160, leftover: 0 });
    expect(planFlex({ ...at, extra: 800 }, { ...male, targets: { kcal: 1640 } })).toMatchObject({ spread: 6, per: 130, even: true, leftover: 0 });
  });

  it('a day with no room gets no entry; the others take the rest', () => {
    // day 10 already at the floor (1500 - 300); rooms [300, 0, 300, 300, 300, 300]
    const prof = { ...base, targets: { kcal: 1500 } };
    const out = planFlex({ ...at, id: 'p2', extra: 500, flex: [{ id: 'p0', date: '2026-10-10', kcal_delta: -300 }] }, prof);
    expect(out).toMatchObject({ spread: 6, per: 100, even: false, leftover: 0 });
    expect(cuts(out.flex.filter((x) => x.id === 'p2'))).toEqual([['2026-10-09', -100], ['2026-10-11', -100], ['2026-10-12', -100], ['2026-10-13', -100], ['2026-10-14', -100]]);
  });

  it('decided: keep (#167): drops entries dated before today - 7 (today, not the planned date), keeps later ones, crosses month ends, leaves the input alone', () => {
    const old: FlexEntry[] = [
      { id: 'o', date: '2026-09-30', kcal_delta: 300 },
      { id: 'k', date: '2026-10-01', kcal_delta: -100 },
      { id: 'f', date: '2026-11-02', kcal_delta: -100 },
    ];
    const keep = JSON.stringify(old);
    const out = planFlex({ extra: 300, date: '2026-10-30', today: '2026-10-08', id: 'p1', flex: old }, null);
    expect(out.flex.map((x) => [x.id, x.date])).toEqual([
      ['k', '2026-10-01'],
      ['f', '2026-11-02'],
      ['p1', '2026-10-30'],
      ['p1', '2026-10-31'],
      ['p1', '2026-11-01'],
      ['p1', '2026-11-02'],
    ]);
    expect(JSON.stringify(old)).toBe(keep);
    expect(planFlex({ ...at, extra: 300, flex: undefined }, null).flex).toHaveLength(4);
  });

  it('pruned entries no longer limit the cut', () => {
    // the -700 on 2026-10-09 is older than today - 7, so it is dropped before the rooms are worked out
    const out = planFlex({ extra: 300, date: '2026-10-08', today: '2026-10-20', id: 'p1', flex: [{ id: 'o', date: '2026-10-09', kcal_delta: -700 }] }, null);
    expect(out).toMatchObject({ spread: 3, per: 100, even: true, leftover: 0 });
  });

  it('undoFlex removes every entry of the plan and nothing else', () => {
    const a = planFlex({ ...at, extra: 500 }, null).flex;
    const b = planFlex({ ...at, id: 'p2', date: '2026-10-09', extra: 300, flex: a }, null).flex;
    expect(undoFlex(b, 'p1')).toEqual(b.filter((x) => x.id === 'p2'));
    expect(undoFlex(b, 'p2')).toEqual(a);
    expect(undoFlex(b, 'none')).toEqual(b);
    expect(undoFlex(null, 'p1')).toEqual([]);
    expect(undoFlex(undefined, 'p1')).toEqual([]);
  });

  it(`matches prototype planFlex and case 'flex-undo' over ${RUNS} random plans; no new cut takes a day below the floor`, () => {
    const r = rng(2923);
    const days = ['2026-09-28', '2026-09-30', '2026-10-01', '2026-10-05', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-30', '2027-01-02'];
    const ids = ['a', 'b', 'c'];
    let leftovers = 0;
    let uneven = 0;
    let holds = 0;
    for (let i = 0; i < RUNS; i++) {
      const prof = r() < 0.15 ? null : randomProfile(r);
      const flex: FlexEntry[] = Array.from({ length: Math.floor(r() * 8) }, () => ({ id: pickOf(r, ids), date: pickOf(r, days), kcal_delta: pickOf(r, [300, 500, 800, -100, -170, -270, -400]) }));
      const extra = r() < 0.7 ? pickOf(r, [300, 500, 800]) : Math.round(r() * 3000);
      const date = pickOf(r, days);
      const today = pickOf(r, days);
      const labHold = pickOf(r, [true, false, undefined]);
      const input: PlanFlexInput = { extra, date, today, id: 'new', flex: r() < 0.1 ? undefined : flex, labHold };
      const got = planFlex(input, prof);
      const want = protoRun(input, prof);
      expect(got.flex).toEqual(want.flex.map((x) => ({ id: x.id, date: x.date, kcal_delta: x.d })));
      expect(flexToast(extra, got)).toBe(want.toast);
      const undo = pickOf(r, [...ids, 'new']);
      expect(undoFlex(got.flex, undo)).toEqual(proto.flexUndo(want.flex, undo).map((x) => ({ id: x.id, date: x.date, kcal_delta: x.d })));
      const floor = prof ? calcTargets(toTargetsProfile(prof)).floor : FLEX_FLOOR_DEFAULT;
      const mine = got.flex.filter((x) => x.id === 'new' && x.kcal_delta < 0);
      for (const x of mine) {
        expect(kcalTarget(x.date, { flex: got.flex }, prof)).toBeGreaterThanOrEqual(floor);
        expect(-x.kcal_delta % 10).toBe(0);
      }
      expect(-mine.reduce((a, x) => a + x.kcal_delta, 0) + got.leftover).toBeLessThanOrEqual(extra);
      if (got.leftover > 0) leftovers++;
      if (!got.even && got.per > 0) uneven++;
      if (labHold && prof && mine.length) holds++;
    }
    expect(leftovers).toBeGreaterThan(50);
    expect(uneven).toBeGreaterThan(50);
    expect(holds).toBeGreaterThan(50);
  });
});

describe('stepServings and highProtein', () => {
  it('0.5 to 10 in steps of 0.5', () => {
    expect([SERVINGS_MIN, SERVINGS_MAX, SERVINGS_STEP]).toEqual([0.5, 10, 0.5]);
    expect([stepServings(1, 1), stepServings(1, -1), stepServings(0.5, -1), stepServings(10, 1), stepServings(9.8, 1)]).toEqual([1.5, 0.5, 0.5, 10, 10]);
  });
  it('matches prototype case serv from every reachable value and some others', () => {
    for (let s = 0.5; s <= 10; s += 0.5)
      for (const d of [1, -1] as const) expect(stepServings(s, d)).toBe(proto.serv(s, String(d * 0.5)));
    for (const s of [0, 0.3, 1.2, 12]) for (const d of [1, -1] as const) expect(stepServings(s, d)).toBe(proto.serv(s, String(d * 0.5)));
  });
  it('high protein: kcal above 0 and at least 8 g protein per 100 kcal', () => {
    expect(highProtein(byName('Chicken breast, cooked'))).toBe(true);
    expect(highProtein(byName('Roti / chapati'))).toBe(false);
    expect(highProtein({ per_serving: { kcal: 100, protein_g: 8 } })).toBe(true);
    expect(highProtein({ per_serving: { kcal: 100, protein_g: 7.99 } })).toBe(false);
    expect(highProtein({ per_serving: { kcal: 0, protein_g: 5 } })).toBe(false);
  });
  it(`matches the prototype badge on every food and ${RUNS} random ones`, () => {
    for (const f of protoCatalog.slice(0, proto.FOODS.length)) {
      const row = proto.FOODS.find((x) => x[0] === f.name);
      expect([f.name, highProtein(f)]).toEqual([f.name, proto.highProtein(row!)]);
    }
    const r = rng(8);
    for (let i = 0; i < RUNS; i++) {
      const kcal = pickOf(r, [0, 50, 100, 125, 250, Math.round(r() * 600), r() * 600]);
      const p = pickOf(r, [0, 4, 8, 10, 20, kcal * 0.08, Math.round(r() * 400) / 10]);
      expect(highProtein({ per_serving: { kcal, protein_g: p } })).toBe(proto.highProtein(['x', '1', kcal, p, 0, 0]));
    }
  });
});

describe('customFood and saveMyFood', () => {
  const base = { name: 'Office thali', kcal: '', protein: '20', carbs: '90', fat: '25', qty: '', unit: '' };
  it('kcal from macros when empty, quantity 1 when empty or 0, unit "1 serving" when empty', () => {
    const r = customFood(base);
    expect(r).toEqual({
      kind: 'ok',
      log: { name: 'Office thali', qty: 1, kcal: 665, protein_g: 20, carbs_g: 90, fat_g: 25 },
      food: { name: 'Office thali', unit: '1 serving', kcal: 665, protein_g: 20, carbs_g: 90, fat_g: 25, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' },
    });
    expect(customFood({ ...base, kcal: '700,5', qty: '0', unit: ' 1 plate ', name: '  Thali ' })).toMatchObject({ log: { name: 'Thali', qty: 1, kcal: 700.5 }, food: { unit: '1 plate' } });
    expect(customFood({ ...base, protein: '0.1', carbs: '', fat: '' })).toEqual({ kind: 'no-kcal' }); // round(0.4) = 0
  });
  it('no name, then no calories', () => {
    expect(customFood({ ...base, name: '  ' })).toEqual({ kind: 'no-name' });
    expect(customFood({ ...base, protein: '', carbs: '', fat: '' })).toEqual({ kind: 'no-kcal' });
    expect(customFood({ ...base, name: '', protein: '', carbs: '', fat: '' })).toEqual({ kind: 'no-name' });
  });
  it('a negative quantity, calorie or macro value is invalid (#150: the prototype logs it)', () => {
    expect(customFood({ ...base, qty: '-2' })).toEqual({ kind: 'invalid' });
    expect(customFood({ ...base, kcal: '-100' })).toEqual({ kind: 'invalid' });
    expect(customFood({ ...base, fat: '-1' })).toEqual({ kind: 'invalid' });
    expect(customFood({ ...base, protein: '-5', carbs: '5', fat: '' })).toEqual({ kind: 'invalid' }); // kcal 0 too: invalid first
    expect(customFood({ ...base, name: '', qty: '-2' })).toEqual({ kind: 'no-name' });
    expect(customFood({ ...base, qty: '0' })).toMatchObject({ kind: 'ok', log: { qty: 1 } });
    expect(proto.addCustom({ cfName: 'Thali', cfK: '-100', cfQ: '-2' }, false, []).meal).toMatchObject({ qty: -2, kcal: -100 });
  });
  it('a trimmed name over 200 characters is too long (#150: the contract limit; the prototype logs it)', () => {
    const n200 = 'a'.repeat(200);
    expect(FOOD_NAME_MAX).toBe(200);
    expect(customFood({ ...base, name: n200 })).toMatchObject({ kind: 'ok', log: { name: n200 }, food: { name: n200 } });
    expect(customFood({ ...base, name: `  ${n200}  ` })).toMatchObject({ kind: 'ok', log: { name: n200 } }); // checked after trimming
    expect(customFood({ ...base, name: 'a'.repeat(201) })).toEqual({ kind: 'name-too-long' });
    expect(customFood({ ...base, name: 'a'.repeat(201), qty: '-2', protein: '', carbs: '', fat: '' })).toEqual({ kind: 'name-too-long' }); // before invalid and no-kcal
    expect(customFood({ ...base, name: '   ' })).toEqual({ kind: 'no-name' });
    expect(proto.addCustom({ cfName: 'a'.repeat(201), cfK: '100' }, false, []).meal).toMatchObject({ name: 'a'.repeat(201) });
  });
  it('saving puts the food first, drops the same name and keeps 60', () => {
    const list = Array.from({ length: 60 }, (_, i) => ({ name: `F${i}` }));
    expect(saveMyFood(list, { name: 'New' }).map((f) => f.name)).toEqual(['New', ...list.slice(0, 59).map((f) => f.name)]);
    expect(saveMyFood(list, { name: 'F10' }).map((f) => f.name)).toEqual(['F10', ...list.filter((f) => f.name !== 'F10').map((f) => f.name)]);
    expect(MY_FOODS_MAX).toBe(60);
  });
  it(`matches prototype case addcustom over ${RUNS} random forms`, () => {
    const r = rng(60);
    const vals = ['', '0', '-3', 'abc', '1,5', '12', '250', ' 7.25 ', String(Math.round(r() * 1000) / 10)];
    for (let i = 0; i < RUNS; i++) {
      const v = {
        cfName: pickOf(r, ['', '  ', 'Thali', ' Lassi ', ...NEW_NAMES, 'a'.repeat(200), ` ${'b'.repeat(201)} `]),
        cfK: pickOf(r, vals),
        cfP: pickOf(r, vals),
        cfC: pickOf(r, vals),
        cfF: pickOf(r, vals),
        cfQ: pickOf(r, vals),
        cfU: pickOf(r, ['', '  ', '1 plate', ' 200 g ']),
      };
      const save = r() < 0.6;
      const my = Array.from({ length: pickOf(r, [0, 3, 59, 60, 61]) }, (_, k) => ({ name: k < 8 ? (NEW_NAMES[k] as string) : `F${k}`, unit: '1 serving', kcal: 1, p: 0, c: 0, f: 0 }));
      const p = proto.addCustom(v, save, my);
      const got = customFood({ name: v.cfName, kcal: v.cfK, protein: v.cfP, carbs: v.cfC, fat: v.cfF, qty: v.cfQ, unit: v.cfU });
      // Exception to the prototype (#150): a trimmed name over 200 characters is `name-too-long`.
      if (v.cfName.trim().length > 200) {
        expect(got).toEqual({ kind: 'name-too-long' });
        continue;
      }
      expect(got.kind).not.toBe('name-too-long');
      // Exception to the prototype (#150): negative values or a quantity at or below 0 are `invalid`.
      const bad = !!v.cfName.trim() && ([v.cfK, v.cfP, v.cfC, v.cfF].some((x) => num(x) < 0) || (num(v.cfQ) || 1) <= 0);
      if (bad) {
        expect(got).toEqual({ kind: 'invalid' });
        continue;
      }
      expect(got.kind).not.toBe('invalid');
      if (got.kind === 'no-name') expect(p.toast).toBe('Give the food a name.');
      else if (got.kind === 'no-kcal') expect(p.toast).toBe('Enter calories or at least one macro.');
      else if (got.kind === 'ok') {
        const m = p.meal!;
        expect(got.log).toEqual({ name: m.name, qty: m.qty, kcal: m.kcal, protein_g: m.p, carbs_g: m.c, fat_g: m.f });
        if (save) {
          const saved = saveMyFood(my.map((x) => ({ ...x }) as ProtoMyFood), { name: got.food.name, unit: got.food.unit, kcal: got.food.kcal, p: got.food.protein_g, c: got.food.carbs_g, f: got.food.fat_g });
          expect(saved).toEqual(p.myFoods);
        } else expect(p.myFoods).toBe(my);
      }
      if (got.kind !== 'ok') expect(p.meal).toBeNull();
    }
  });
});

describe('userFoodFacts', () => {
  const u: UserFoodFields = { name: 'Office thali', unit: '', kcal: 665, protein_g: 20, carbs_g: 90, fat_g: 25, fibre_g: 6, added_sugar_g: null, fruit_veg_servings: 1, origin: 'custom' };
  it('maps a contract UserFood to every food-maths input', () => {
    const f = userFoodFacts(u);
    expect(f).toEqual({ name: 'Office thali', aliases: [], serving: { label: '1 serving', grams: null }, per_serving: { kcal: 665, protein_g: 20, carbs_g: 90, fat_g: 25, fibre_g: 6, added_sugar_g: null }, fruit_veg_servings: 1 });
    expect(userFoodFacts({ ...u, unit: '1 bowl (250 g)' }).serving).toEqual({ label: '1 bowl (250 g)', grams: 250 });
    const log = { name: 'Office thali', qty: 2, kcal: 665, protein_g: 20, carbs_g: 90, fat_g: 25 };
    expect(logTotals([log], [...foods, f])).toMatchObject({ fibre_g: 12, added_sugar_g: 0, withoutFibre: 0 });
    expect(fruitVegServings([log], [...foods, f])).toBe(2);
    expect(searchFoods('thali', [f, ...foods])).toEqual([f]);
    expect(quantityFromGrams(userFoodFacts({ ...u, unit: '200 g' }), 300)).toEqual({ kind: 'grams', qty: 1.5 });
  });
  it(`gives the same totals, search and grams as the prototype's myFoods over ${RUNS} random days`, () => {
    const r = rng(1529);
    for (let i = 0; i < RUNS; i++) {
      const my = randomMyFoods(r, true);
      const meals = randomMeals(r, my);
      proto.S.settings.myFoods = my;
      const users = my.map((m) => userFoodFacts({ name: m.name, unit: m.unit, kcal: m.kcal, protein_g: m.p, carbs_g: m.c, fat_g: m.f, fibre_g: m.fib ?? null, added_sugar_g: m.sug ?? null, fruit_veg_servings: m.veg ?? null }));
      const logs = meals.map(toLog);
      const pf = proto.fibreTotals(meals);
      expect(logTotals(logs, [...protoCatalog, ...users])).toMatchObject({ fibre_g: pf.fib, added_sugar_g: pf.sug, withoutFibre: pf.unknown });
      expect(fruitVegServings(logs, [...protoCatalog, ...users])).toBe(pf.veg);
      const g = pickOf(r, ['', '50', '4', '300']);
      for (const [k, u2] of users.entries()) {
        if (protoCatalog.some((c) => c.name === u2.name)) continue; // prototype pick finds the user food first by name only when names differ
        const p = proto.pick(my[k]!.name, g, 1);
        const want = 'err' in p ? 'not-in-grams' : num(g) > 0 ? (p.qty === 0 ? 'too-small' : 'grams') : 'servings';
        expect(quantityFromGrams(u2, g).kind).toBe(want);
      }
    }
    proto.S.settings.myFoods = [];
  });
});
