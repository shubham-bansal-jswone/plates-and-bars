import {
  recipeTotals,
  recipeFood,
  presetIngredients,
  stepRecipeLog,
  saveBuiltFood,
  kitchenTest,
  kitchenTestFood,
  ingredientGrams,
  UNIT_GRAMS,
  OIL_LEVEL,
  RECIPE_VEG_INGREDIENTS,
  FRUIT_VEG_SERVING_G,
  BUILT_FOODS_MAX,
  RECIPE_LOG_MIN,
  RECIPE_LOG_MAX,
  RECIPE_LOG_STEP,
  FOOD_NAME_MAX,
  userFoodFacts,
  type IngredientRow,
  type RawIngredient,
  type OilLevel,
  type UserFoodFields,
} from '../src/index';
import rawContent from '../../../content/raw-ingredients.json';
import recipesContent from '../../../content/recipes.json';
import { loadGolden } from './helpers';
import { loadRecipes, type ProtoBuiltFood, type ProtoKitchenTest, type ProtoRB, type ProtoRow } from './prototype-recipes';
import { rng } from './prototype-plan';

interface GoldenFoods {
  raw100g: Record<string, [number, number, number, number]>;
  rawFibre100g: Record<string, number>;
}

const golden = loadGolden<GoldenFoods>('foods');
const proto = loadRecipes();
const RUNS = 4000;

// content is passed to the recipe functions as is; these assignments are the type check.
const raw: readonly RawIngredient[] = rawContent.ingredients;
const katoriG: number = recipesContent.katori_g;
const preset = (name: string): IngredientRow[] => {
  const p = recipesContent.presets.find((x) => x.name === name);
  if (!p) throw new Error(`no preset ${name}`);
  return p.ingredients;
};

const toRow = (r: ProtoRow): IngredientRow => ({ ingredient: r.ing, amount: r.amt, unit: r.unit });

/** Built food (prototype `myFoods` item) in contract `UserFood` fields. */
function toContract(f: ProtoBuiltFood): UserFoodFields {
  return {
    name: f.name,
    unit: f.unit,
    kcal: f.kcal,
    protein_g: f.p,
    carbs_g: f.c,
    fat_g: f.f,
    fibre_g: f.fib,
    added_sugar_g: f.sug,
    fruit_veg_servings: f.veg ?? null,
    origin: f.recipe ? 'recipe' : f.kitchen ? 'kitchen_test' : 'custom',
  };
}

const ING = [...Object.keys(golden.raw100g), 'Not an ingredient'];
const AMOUNTS = ['', '0', '1', '5', '12,5', '30', '45.5', '80', '150', '200', '333', '500', '1200', 'abc', '-20'];
const UNITS = ['g', 'g', 'tsp', 'tbsp', 'cup'];
const YIELDS = ['', '0', '1', '2.5', '3', '4', '5', '6', '7,5', '-1', 'x'];
const GRAMS = ['', '0', '150', '400', '725', '1000', '1333', '2200', '-5'];

function randomRows(rand: () => number): ProtoRow[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  return Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({ ing: pick(ING), amt: pick(AMOUNTS), unit: pick(UNITS) }));
}

describe('raw ingredients (golden raw100g, rawFibre100g; content/raw-ingredients.json)', () => {
  it('golden raw100g is the prototype RAW, fasting-day additions included', () => {
    expect(proto.RAW).toEqual(golden.raw100g);
  });

  it('golden rawFibre100g is the prototype RAW_FIB, and every fibre entry has a raw entry', () => {
    expect(proto.RAW_FIB).toEqual(golden.rawFibre100g);
    for (const name of Object.keys(golden.rawFibre100g)) expect(golden.raw100g[name]).toBeDefined();
  });

  it('content per_100g equals golden raw100g and rawFibre100g (no fibre entry stored as 0), in order', () => {
    expect(raw.map((i) => i.name)).toEqual(Object.keys(golden.raw100g));
    for (const i of raw) {
      const [kcal, protein_g, carbs_g, fat_g] = golden.raw100g[i.name]!;
      expect(i.per_100g).toEqual({ kcal, protein_g, carbs_g, fibre_g: golden.rawFibre100g[i.name] ?? 0, fat_g });
    }
  });

  it('content fatty flags are the prototype FATTY', () => {
    expect(raw.filter((i) => i.fatty).map((i) => i.name)).toEqual([...proto.FATTY]);
  });

  it('content katori_g is the prototype KATORI_G', () => {
    expect(katoriG).toBe(proto.KATORI_G);
  });

  it('content presets are the prototype PRESETS', () => {
    expect(recipesContent.presets.map((p) => p.name)).toEqual(Object.keys(proto.PRESETS));
    for (const p of recipesContent.presets) {
      expect(p.ingredients).toEqual(proto.PRESETS[p.name]!.rows.map(([ingredient, amount]) => ({ ingredient, amount, unit: 'g' })));
      expect(p.katoris).toBe(proto.PRESETS[p.name]!.k);
    }
  });

  it('a single golden ingredient gives its raw100g values per 100 g', () => {
    for (const [name, [kcal, p, c, f]] of Object.entries(golden.raw100g)) {
      const r = recipeTotals({ ingredients: [{ ingredient: name, amount: 100, unit: 'g' }], yield_mode: 'katori', katoris: 1, cooked_g: null }, raw, katoriG);
      expect(r.total).toEqual({ kcal, protein_g: p, carbs_g: c, fat_g: f, grams: 100 });
      const k = kitchenTest({ ingredients: [{ ingredient: name, amount: 100, unit: 'g' }], pot_g: null, pot_full_g: null, cooked_g: 100, serving_g: null }, raw);
      expect(k.ready && k.per100g.fibre_g).toBe(golden.rawFibre100g[name] ?? 0);
    }
  });

  it('names that are Object members (constructor, toString, __proto__) are unknown ingredients', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const rows: IngredientRow[] = [{ ingredient: name, amount: 100, unit: 'g' }];
      expect(recipeTotals({ ingredients: rows, yield_mode: 'katori', katoris: 1, cooked_g: null }, raw, katoriG).total).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, grams: 0 });
      expect(recipeFood({ name: 'X', ingredients: rows, yield_mode: 'katori', katoris: 1, cooked_g: null }, raw, katoriG).kind).toBe('no-ingredients');
      expect(kitchenTestFood({ name: 'X', ingredients: rows, pot_g: null, pot_full_g: null, cooked_g: 100, serving_g: 50, serving_name: 'katori' }, raw).kind).toBe('no-ingredients');
      expect(presetIngredients(rows, 'rich', raw)).toEqual(rows);
    }
  });

  it('the first of a repeated ingredient name wins', () => {
    const twice: RawIngredient[] = [
      { name: 'A', fatty: false, per_100g: { kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: null } },
      { name: 'A', fatty: true, per_100g: { kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 100, fibre_g: 0 } },
    ];
    expect(recipeTotals({ ingredients: [{ ingredient: 'A', amount: 100, unit: 'g' }], yield_mode: 'katori', katoris: 1, cooked_g: null }, twice, 150).total.kcal).toBe(100);
  });
});

describe('constants', () => {
  it('match the prototype', () => {
    expect(UNIT_GRAMS).toEqual({ g: 1, tsp: 5, tbsp: 15 });
    expect(OIL_LEVEL).toEqual({ low: 0.5, normal: 1, rich: 2 });
    expect(FRUIT_VEG_SERVING_G).toBe(80);
    expect(BUILT_FOODS_MAX).toBe(80);
    expect([RECIPE_LOG_MIN, RECIPE_LOG_MAX, RECIPE_LOG_STEP]).toEqual([0.5, 6, 0.5]);
    expect(RECIPE_VEG_INGREDIENTS).toContain('Capsicum');
  });

  it('ingredientGrams converts units and treats an unknown unit as grams', () => {
    expect(ingredientGrams({ ingredient: 'Oil', amount: 2, unit: 'tbsp' })).toBe(30);
    expect(ingredientGrams({ ingredient: 'Oil', amount: '1,5', unit: 'tsp' })).toBe(7.5);
    expect(ingredientGrams({ ingredient: 'Oil', amount: 40, unit: 'cup' })).toBe(40);
  });
});

describe('recipeTotals (prototype rbTotals)', () => {
  it('worked example: Dal preset, 5 katoris', () => {
    const r = recipeTotals(
      { ingredients: presetIngredients(preset('Dal'), 'normal', raw), yield_mode: 'katori', katoris: 5, cooked_g: null },
      raw,
      katoriG,
    );
    // 150 g toor dal + 60 g onion + 80 g tomato + 15 g ghee
    expect(r.total.grams).toBe(305);
    expect(r.total.kcal).toBeCloseTo(343 * 1.5 + 40 * 0.6 + 18 * 0.8 + 876 * 0.15, 9);
    expect(r.katoris).toBe(5);
    expect(r.perKatori!.kcal).toBeCloseTo(r.total.kcal / 5, 9);
  });

  it('grams mode turns the pot weight into katoris of 150 g', () => {
    const r = recipeTotals({ ingredients: [{ ingredient: 'Rice (raw)', amount: 100, unit: 'g' }], yield_mode: 'grams', katoris: 4, cooked_g: 300 }, raw, katoriG);
    expect(r.katoris).toBe(2);
    expect(r.perKatori!.kcal).toBe(182.5);
  });

  it('no yield gives no per-katori values', () => {
    const rows: IngredientRow[] = [{ ingredient: 'Egg', amount: 50, unit: 'g' }];
    expect(recipeTotals({ ingredients: rows, yield_mode: 'grams', katoris: 4, cooked_g: null }, raw, katoriG).perKatori).toBeNull();
    expect(recipeTotals({ ingredients: rows, yield_mode: 'katori', katoris: 0, cooked_g: 300 }, raw, katoriG).perKatori).toBeNull();
    expect(recipeTotals({ ingredients: rows, yield_mode: 'katori', katoris: -2, cooked_g: null }, raw, katoriG).perKatori).toBeNull();
  });

  it(`matches the prototype over ${RUNS} random recipes`, () => {
    const rand = rng(195);
    for (let i = 0; i < RUNS; i++) {
      const rb = { rows: randomRows(rand), ymode: rand() < 0.5 ? 'katori' : 'grams', katoris: YIELDS[Math.floor(rand() * YIELDS.length)]!, grams: GRAMS[Math.floor(rand() * GRAMS.length)]! };
      const want = proto.rbTotals(rb);
      const got = recipeTotals({ ingredients: rb.rows.map(toRow), yield_mode: rb.ymode as 'katori' | 'grams', katoris: rb.katoris, cooked_g: rb.grams }, raw, katoriG);
      expect(got.total).toEqual({ kcal: want.t.kcal, protein_g: want.t.p, carbs_g: want.t.c, fat_g: want.t.f, grams: want.t.g });
      expect(got.katoris).toBe(want.kat);
      expect(got.perKatori).toEqual(want.per && { kcal: want.per.kcal, protein_g: want.per.p, carbs_g: want.per.c, fat_g: want.per.f });
    }
  });
});

describe('presetIngredients (prototype rbFromPreset rows)', () => {
  it.each(Object.keys(proto.PRESETS).flatMap((k) => (['low', 'normal', 'rich'] as OilLevel[]).map((oil) => [k, oil] as const)))('%s at %s oil (content preset)', (k, oil) => {
    const want = proto.rbFromPreset(k, oil).map(toRow).map((r) => ({ ...r, amount: Number(r.amount) }));
    expect(presetIngredients(preset(k), oil, raw)).toEqual(want);
  });

  it('halves and rounds fatty ingredients only; tsp and tbsp become grams', () => {
    expect(presetIngredients([{ ingredient: 'Oil', amount: 1, unit: 'tbsp' }, { ingredient: 'Sugar', amount: 1, unit: 'tsp' }], 'rich', raw)).toEqual([
      { ingredient: 'Oil', amount: 30, unit: 'g' },
      { ingredient: 'Sugar', amount: 5, unit: 'g' },
    ]);
    const rows: IngredientRow[] = [{ ingredient: 'Ghee', amount: 15, unit: 'g' }, { ingredient: 'Onion', amount: 60.4, unit: 'g' }, { ingredient: 'Fresh cream', amount: 25, unit: 'g' }];
    expect(presetIngredients(rows, 'low', raw)).toEqual([
      { ingredient: 'Ghee', amount: 8, unit: 'g' },
      { ingredient: 'Onion', amount: 60, unit: 'g' },
      { ingredient: 'Fresh cream', amount: 13, unit: 'g' },
    ]);
  });
});

describe('stepRecipeLog (prototype case rb-log)', () => {
  it('matches the prototype for every start and step', () => {
    for (let log = 0.5; log <= 6; log += 0.5) {
      for (const d of ['-0.5', '0.5']) {
        expect(stepRecipeLog(log, d)).toBe(proto.recipeAction('rb-log', { d }, { log }, { myFoods: [], recipes: [] }).RB.log);
      }
    }
    expect(stepRecipeLog(0.5, -0.5)).toBe(0.5);
    expect(stepRecipeLog(6, 0.5)).toBe(6);
  });
});

describe('recipeFood (prototype case rb-save)', () => {
  const NAMES = ['', '   ', 'Mom’s dal', '  Rajma  ', 'Khichdi'];

  it(`matches the prototype's checks, saved rows and food over ${RUNS} random recipes`, () => {
    const rand = rng(2195);
    let invalids = 0;
    for (let i = 0; i < RUNS; i++) {
      const rb: Partial<ProtoRB> = {
        name: NAMES[Math.floor(rand() * NAMES.length)]!,
        rows: randomRows(rand),
        ymode: rand() < 0.5 ? 'katori' : 'grams',
        katoris: YIELDS[Math.floor(rand() * YIELDS.length)]!,
        grams: GRAMS[Math.floor(rand() * GRAMS.length)]!,
        editing: null,
      };
      const want = proto.recipeAction('rb-save', {}, rb, { myFoods: [], recipes: [] });
      const got = recipeFood({ name: rb.name!, ingredients: rb.rows!.map(toRow), yield_mode: rb.ymode as 'katori' | 'grams', katoris: rb.katoris!, cooked_g: rb.grams! }, raw, katoriG);
      const kind = { 'Give the recipe a name.': 'no-name', 'Add at least one ingredient with an amount.': 'no-ingredients', 'Add how many katoris it made, or the cooked weight.': 'no-yield' }[want.toast] ?? 'ok';
      // #150: past the name check, a negative amount is `invalid` where the prototype goes on.
      const negative = rb.rows!.some((r) => parseFloat(r.amt.replace(',', '.')) < 0);
      expect(got.kind).toBe(kind !== 'no-name' && negative ? 'invalid' : kind);
      if (negative) invalids++;
      if (got.kind !== 'ok') continue;
      expect(want.toast).toBe(`Saved ${got.name} to your foods`);
      expect(got.food).toEqual(toContract(want.settings.myFoods[0]!));
      expect(got.ingredients).toEqual(want.settings.recipes[0]!.rows.map(toRow));
    }
    expect(invalids).toBeGreaterThan(100);
  });

  it('a negative amount is invalid (#150; the prototype saves fat_g -4.2 here)', () => {
    const rows: IngredientRow[] = [{ ingredient: 'Toor dal (dry)', amount: 100, unit: 'g' }, { ingredient: 'Oil', amount: -10, unit: 'g' }];
    const want = proto.recipeAction('rb-save', {}, { name: 'Dal', rows: rows.map((r) => ({ ing: r.ingredient, amt: String(r.amount), unit: r.unit })), ymode: 'katori', katoris: '2', editing: null }, { myFoods: [], recipes: [] });
    expect(want.settings.myFoods[0]!.f).toBe(-4.2);
    expect(recipeFood({ name: 'Dal', ingredients: rows, yield_mode: 'katori', katoris: 2, cooked_g: null }, raw, katoriG)).toEqual({ kind: 'invalid' });
    expect(recipeFood({ name: ' ', ingredients: rows, yield_mode: 'katori', katoris: 2, cooked_g: null }, raw, katoriG)).toEqual({ kind: 'no-name' });
  });

  it('worked example: sugar and vegetables per katori', () => {
    const r = recipeFood(
      {
        name: ' Kheer-ish ',
        ingredients: [
          { ingredient: 'Milk (toned)', amount: 500, unit: 'g' },
          { ingredient: 'Sugar', amount: 4, unit: 'tbsp' },
          { ingredient: 'Spinach', amount: 160, unit: 'g' },
          { ingredient: 'Rice (raw)', amount: 0, unit: 'g' },
        ],
        yield_mode: 'katori',
        katoris: 4,
        cooked_g: null,
      },
      raw,
      katoriG,
    );
    expect(r).toEqual({
      kind: 'ok',
      name: 'Kheer-ish',
      ingredients: [
        { ingredient: 'Milk (toned)', amount: 500, unit: 'g' },
        { ingredient: 'Sugar', amount: 4, unit: 'tbsp' },
        { ingredient: 'Spinach', amount: 160, unit: 'g' },
      ],
      food: {
        name: 'Kheer-ish',
        unit: '1 katori',
        kcal: Math.round((290 + 232.2 + 36.8) / 4),
        protein_g: Math.round(((16 + 0 + 4.64) / 4) * 10) / 10,
        carbs_g: Math.round(((24 + 60 + 5.76) / 4) * 10) / 10,
        fat_g: Math.round(((15 + 0 + 0.64) / 4) * 10) / 10,
        fibre_g: Math.round(((2.2 * 160) / 100 / 4) * 10) / 10,
        added_sugar_g: 15,
        fruit_veg_servings: 0.5,
        origin: 'recipe',
      },
    });
  });

  it('rejects a name over the contract limit (as customFood, #150; the prototype saves it)', () => {
    const base = { ingredients: [{ ingredient: 'Egg', amount: 100, unit: 'g' }], yield_mode: 'katori' as const, katoris: 1, cooked_g: null };
    expect(recipeFood({ ...base, name: 'x'.repeat(FOOD_NAME_MAX) }, raw, katoriG).kind).toBe('ok');
    expect(recipeFood({ ...base, name: 'x'.repeat(FOOD_NAME_MAX + 1) }, raw, katoriG).kind).toBe('name-too-long');
  });

  it('the saved food reads back through userFoodFacts', () => {
    const r = recipeFood({ name: 'Dal', ingredients: presetIngredients(preset('Dal'), 'normal', raw), yield_mode: 'katori', katoris: 5, cooked_g: null }, raw, katoriG);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(userFoodFacts(r.food).serving).toEqual({ label: '1 katori', grams: null });
  });
});

describe('saveBuiltFood (myFoods step of rb-save and ktSave)', () => {
  const foods = (n: number): ProtoBuiltFood[] => Array.from({ length: n }, (_, i) => ({ name: `F${i}`, unit: '1 katori', kcal: i, p: 0, c: 0, f: 0, fib: 0, sug: 0 }));
  const rb = (name: string, editing: number | null): Partial<ProtoRB> => ({ name, rows: [{ ing: 'Egg', amt: '100', unit: 'g' }], ymode: 'katori', katoris: '1', editing });

  it('new recipe: goes first, same name dropped, 80 kept', () => {
    const my = foods(90);
    const want = proto.recipeAction('rb-save', {}, rb('F3', null), { myFoods: my, recipes: [] }).settings.myFoods;
    const r = recipeFood({ name: 'F3', ingredients: [{ ingredient: 'Egg', amount: '100', unit: 'g' }], yield_mode: 'katori', katoris: '1', cooked_g: '' }, raw, katoriG);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(saveBuiltFood(my.map(toContract), r.food)).toEqual(want.map(toContract));
    expect(want).toHaveLength(80);
  });

  it('edited recipe renamed: the old name is dropped too', () => {
    const my = foods(5);
    const want = proto.recipeAction('rb-save', {}, rb('New', 0), { myFoods: my, recipes: [{ name: 'F2', rows: [] }] }).settings.myFoods;
    const r = recipeFood({ name: 'New', ingredients: [{ ingredient: 'Egg', amount: 100, unit: 'g' }], yield_mode: 'katori', katoris: 1, cooked_g: null }, raw, katoriG);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(saveBuiltFood(my.map(toContract), r.food, 'F2')).toEqual(want.map(toContract));
    expect(want.map((f) => f.name)).toEqual(['New', 'F0', 'F1', 'F3', 'F4']);
  });

  it('kitchen test: same name replaced', () => {
    const my = foods(85);
    const d: ProtoKitchenTest = { id: 'k1', name: 'F7', rows: [{ ing: 'Egg', amt: '100', unit: 'g' }], pot: '', potFull: '', cooked: '90', serving: '45', sname: 'plate' };
    const want = proto.ktSave(d, true, my).myFoods;
    const r = kitchenTestFood({ name: 'F7', ingredients: [{ ingredient: 'Egg', amount: 100, unit: 'g' }], pot_g: null, pot_full_g: null, cooked_g: 90, serving_g: 45, serving_name: 'plate' }, raw);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(saveBuiltFood(my.map(toContract), r.food)).toEqual(want.map(toContract));
  });
});

const POTS = ['', '0', '350', '600', '1200', 'x'];
const FULLS = ['', '0', '900', '1500', '2750', '300'];
const COOKED = ['', '', '', '0', '650', '1000', '1450', '-40'];
const SERVINGS = ['', '0', '120', '150', '180', '1250'];
const SNAMES = ['katori', 'plate', 'piece', 'glass', 'bowl'];

function randomTest(rand: () => number, name = 'Dal'): ProtoKitchenTest {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  return { id: 'kt', name, rows: randomRows(rand), pot: pick(POTS), potFull: pick(FULLS), cooked: pick(COOKED), serving: pick(SERVINGS), sname: pick(SNAMES) };
}

const testInput = (d: ProtoKitchenTest) => ({
  name: d.name,
  ingredients: d.rows.map(toRow),
  pot_g: d.pot,
  pot_full_g: d.potFull,
  cooked_g: d.cooked,
  serving_g: d.serving,
  serving_name: d.sname,
});

describe('kitchenTest (prototype ktCalc)', () => {
  it(`matches the prototype over ${RUNS} random tests`, () => {
    const rand = rng(3195);
    for (let i = 0; i < RUNS; i++) {
      const d = randomTest(rand);
      const want = proto.ktCalc(d);
      const got = kitchenTest(testInput(d), raw);
      expect(got.total).toEqual({ kcal: want.t.kcal, protein_g: want.t.p, carbs_g: want.t.c, fat_g: want.t.f, fibre_g: want.t.fib, oil_g: want.t.oil, grams: want.t.g });
      expect(got.ready).toBe(want.ready);
      if (!got.ready) continue;
      const p100 = want.per100!;
      expect(got.cooked_g).toBe(want.cooked);
      expect(got.per100g).toEqual({ kcal: p100.kcal, protein_g: p100.p, carbs_g: p100.c, fat_g: p100.f, fibre_g: p100.fib });
      const ps = want.perServ;
      expect(got.perServing).toEqual(ps ? { kcal: ps.kcal, protein_g: ps.p, carbs_g: ps.c, fat_g: ps.f, fibre_g: ps.fib, oil_g: ps.oil, grams: ps.g } : null);
      expect(got.servings).toBe(want.servings);
    }
  });

  it('worked example: pot weights give the cooked weight; per 100 g and per serving', () => {
    const r = kitchenTest(
      {
        ingredients: [
          { ingredient: 'Toor dal (dry)', amount: 200, unit: 'g' },
          { ingredient: 'Ghee', amount: 2, unit: 'tbsp' },
        ],
        pot_g: 800,
        pot_full_g: 1800,
        cooked_g: null,
        serving_g: 200,
      },
      raw,
    );
    if (!r.ready) throw new Error('expected ready');
    expect(r.cooked_g).toBe(1000);
    expect(r.total.oil_g).toBe(30);
    expect(r.per100g.kcal).toBeCloseTo((686 + 262.8) / 10, 9);
    expect(r.per100g.fibre_g).toBeCloseTo(3, 9);
    expect(r.perServing!.oil_g).toBeCloseTo(6, 9);
    expect(r.servings).toBe(5);
  });

  it('a cooked weight entered directly wins over the pot weights', () => {
    const r = kitchenTest({ ingredients: [{ ingredient: 'Egg', amount: 100, unit: 'g' }], pot_g: 100, pot_full_g: 500, cooked_g: 200, serving_g: null }, raw);
    expect(r.ready && r.cooked_g).toBe(200);
  });

  it('PINNED QUIRK (#214): an empty pot weighed as 0 g gives no cooked weight (prototype needs both pot weights non-zero)', () => {
    const d: ProtoKitchenTest = { id: 'k', name: 'Dal', rows: [{ ing: 'Egg', amt: '100', unit: 'g' }], pot: '0', potFull: '500', cooked: '', serving: '', sname: 'katori' };
    expect(proto.ktCalc(d).ready).toBe(false);
    expect(kitchenTest(testInput(d), raw).ready).toBe(false);
  });

  it('pot with food lighter than the pot is not ready', () => {
    expect(kitchenTest({ ingredients: [], pot_g: 900, pot_full_g: 300, cooked_g: null, serving_g: 100 }, raw).ready).toBe(false);
  });
});

describe('kitchenTestFood (prototype ktSave(true))', () => {
  const TOASTS: Record<string, string> = {
    'Name the dish.': 'no-name',
    'Add the raw ingredients with their weights.': 'no-ingredients',
    'Add the cooked weight, or both pot weights.': 'not-ready',
    'Weigh one serving first, so the app knows the portion.': 'no-serving',
  };

  it(`matches the prototype's checks and food over ${RUNS} random tests`, () => {
    const rand = rng(4195);
    const names = ['', '  ', 'Dal', ' Poha ', 'Sabzi'];
    let invalids = 0;
    for (let i = 0; i < RUNS; i++) {
      const d = randomTest(rand, names[Math.floor(rand() * names.length)]!);
      const want = proto.ktSave(d, true, []);
      const got = kitchenTestFood(testInput(d), raw);
      // #150: past the name check, a negative amount or weight is `invalid` where the prototype goes on.
      const negative = [...d.rows.map((r) => r.amt), d.pot, d.potFull, d.cooked, d.serving].some((v) => parseFloat(v.replace(',', '.')) < 0);
      if (negative && want.toast !== 'Name the dish.') {
        expect(got.kind).toBe('invalid');
        invalids++;
        continue;
      }
      expect(got.kind).toBe(TOASTS[want.toast] ?? 'ok');
      if (got.kind === 'no-serving' || got.kind === 'ok') {
        expect(want.kitchen.map((k) => k.name)).toEqual([got.name]);
      } else {
        expect(want.kitchen).toEqual([]);
      }
      if (got.kind !== 'ok') continue;
      expect(want.toast).toBe(`Saved. ${got.name} now logs with your weighed values.`);
      expect(got.food).toEqual(toContract(want.myFoods[0]!));
    }
    expect(invalids).toBeGreaterThan(100);
  });

  it('a negative amount, pot, cooked or serving weight is invalid (#150; the prototype saves "1 katori (-50 g)")', () => {
    const base = { name: 'Dal', ingredients: [{ ingredient: 'Toor dal (dry)', amount: 100, unit: 'g' }], pot_g: null, pot_full_g: null, cooked_g: 300, serving_g: 150, serving_name: 'katori' };
    const d: ProtoKitchenTest = { id: 'k', name: 'Dal', rows: [{ ing: 'Toor dal (dry)', amt: '100', unit: 'g' }], pot: '', potFull: '', cooked: '300', serving: '-50', sname: 'katori' };
    expect(proto.ktSave(d, true, []).myFoods[0]!.unit).toBe('1 katori (-50 g)');
    expect(kitchenTestFood({ ...base, serving_g: -50 }, raw)).toEqual({ kind: 'invalid' });
    expect(kitchenTestFood({ ...base, ingredients: [...base.ingredients, { ingredient: 'Oil', amount: -1, unit: 'tsp' }] }, raw)).toEqual({ kind: 'invalid' });
    expect(kitchenTestFood({ ...base, cooked_g: null, pot_g: -100, pot_full_g: 500 }, raw)).toEqual({ kind: 'invalid' });
    expect(kitchenTestFood({ ...base, cooked_g: null, pot_g: 100, pot_full_g: -500 }, raw)).toEqual({ kind: 'invalid' });
    expect(kitchenTestFood({ ...base, cooked_g: -300 }, raw)).toEqual({ kind: 'invalid' });
    expect(kitchenTestFood({ ...base, serving_g: 0 }, raw)).toEqual({ kind: 'no-serving', name: 'Dal' });
  });

  it('labels the serving with its weight, grouped as the prototype fmt does', () => {
    const base = { name: 'Biryani', ingredients: [{ ingredient: 'Rice (raw)', amount: 1000, unit: 'g' }], pot_g: null, pot_full_g: null, cooked_g: 3000 };
    const big = kitchenTestFood({ ...base, serving_g: 1249.6, serving_name: 'plate' }, raw);
    const d: ProtoKitchenTest = { id: 'k', name: 'Biryani', rows: [{ ing: 'Rice (raw)', amt: '1000', unit: 'g' }], pot: '', potFull: '', cooked: '3000', serving: '1249.6', sname: 'plate' };
    expect(big.kind === 'ok' && big.food.unit).toBe('1 plate (1,250 g)');
    expect(big.kind === 'ok' && big.food.unit).toBe(proto.ktSave(d, true, []).myFoods[0]!.unit);
    const small = kitchenTestFood({ ...base, serving_g: 180, serving_name: 'katori' }, raw);
    expect(small.kind === 'ok' && small.food).toMatchObject({ unit: '1 katori (180 g)', added_sugar_g: 0, fruit_veg_servings: null, origin: 'kitchen_test' });
  });

  it('rejects a name over the contract limit (as customFood, #150; the prototype saves it)', () => {
    const base = { ingredients: [{ ingredient: 'Egg', amount: 100, unit: 'g' }], pot_g: null, pot_full_g: null, cooked_g: 90, serving_g: 45, serving_name: 'katori' };
    expect(kitchenTestFood({ ...base, name: 'x'.repeat(FOOD_NAME_MAX + 1) }, raw).kind).toBe('name-too-long');
  });
});
