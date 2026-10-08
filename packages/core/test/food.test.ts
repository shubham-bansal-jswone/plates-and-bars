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

  it('PINNED QUIRK: content lacks the prototype’s drinks and the eat-out "Cola (330 ml)" fibre row', () => {
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
  it('PINNED QUIRK: a query can span two aliases, since aliases are matched as one string', () => {
    expect(searchFoods('fulka rotli', foods).map((f) => f.name)).toEqual(['Roti / chapati']);
    expect(searchFoods('gh mu', foods).map((f) => f.name)).toEqual(['Chicken breast, cooked', 'Chicken curry']); // "murgh murg"
    expect(searchFoods('peg spirit', protoCatalog).map((f) => f.name)).toEqual(['Whisky, rum or vodka']);
  });
  it('user foods come first and have no aliases', () => {
    const mine = [{ name: 'Office thali' }];
    expect(searchFoods('thali', [...mine, ...foods])).toEqual(mine);
    expect(searchFoods('a', [...mine, ...foods])[0]).toBe(mine[0]);
  });
  it('PINNED QUIRK: the prototype gives a user food the aliases of a shared food with the same name', () => {
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
    expect(unitGrams('1.5 g scoop')).toBe(5); // PINNED QUIRK: decimals lose their whole part
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
  it('PINNED QUIRK: a tiny amount rounds to 0 servings, which is logged', () => {
    expect(quantityFromGrams(byName('Paneer'), 4)).toEqual({ kind: 'grams', qty: 0 });
  });
  it(`matches prototype case 'pick' over ${RUNS} random foods and inputs`, () => {
    const r = rng(97);
    for (let i = 0; i < RUNS; i++) {
      const my = randomMyFoods(r, false);
      proto.S.settings.myFoods = my;
      const all = [...my.map(userFood), ...protoCatalog.slice(0, proto.FOODS.length)];
      const f = pickOf(r, all);
      const g = pickOf(r, ['', '0', '-5', 'abc', '1', '4', '15', '35', '49.95', '2,5', ' 120 ', String(Math.round(r() * 5000) / 10), String(r() * 1000)]);
      const serv = pickOf(r, [0.5, 1, 1.5, 2, 10]);
      const p = proto.pick(f.name, g, serv);
      const want = 'err' in p ? { kind: 'not-in-grams' } : num(g) > 0 ? { kind: 'grams', qty: p.qty } : { kind: 'servings' };
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
  it('PINNED QUIRK: three items in one meal count as three meals, and the fallback applies to today too', () => {
    const breakfast = [logOf(byName('Egg, whole'), 10), logOf(byName('Roti / chapati'), 4), logOf(byName('Toned milk'), 2)];
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
