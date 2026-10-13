import { num } from './num';
import { FOOD_NAME_MAX, type UserFoodFields } from './food';

/**
 * Recipe builder and kitchen tests (spec §5): totals from raw ingredients, cooked yield, per katori,
 * per 100 g and per serving, and the personal food each one saves.
 *
 * The data is content, not code, and is passed in: the raw ingredients (prototype `RAW`, `RAW_FIB` and
 * `FATTY`) as content/raw-ingredients.json `ingredients`, and the katori size (prototype `KATORI_G`) as
 * content/recipes.json `katori_g`. Ingredients come in the contract's `Ingredient` shape, recipes and
 * kitchen tests in the fields of the contract's `Recipe` and `KitchenTest`.
 */

/** Per-100 g values of a raw ingredient. Carbs include fibre. Prototype `RAW[name]` plus `RAW_FIB[name]`. */
export interface Per100g {
  kcal: number;
  protein_g: number;
  /** Total carbohydrate including fibre. */
  carbs_g: number;
  fat_g: number;
  /** Null or 0 where the prototype has no `RAW_FIB` entry; both count as 0, as the prototype does. */
  fibre_g: number | null;
}

/** One raw ingredient: an item of content/raw-ingredients.json `ingredients` (the fields read here). */
export interface RawIngredient {
  name: string;
  /** Oil, ghee, butter or cream: scaled by the oil level and counted as oil. Prototype `FATTY.has(name)`. */
  fatty: boolean;
  per_100g: Per100g;
}

/** Looks ingredients up by own name only, so names such as `constructor` are unknown; the first of a repeated name wins. */
function indexRaw(raw: readonly RawIngredient[]): ReadonlyMap<string, RawIngredient> {
  const m = new Map<string, RawIngredient>();
  for (const i of raw) if (!m.has(i.name)) m.set(i.name, i);
  return m;
}

/** A recipe or kitchen-test row: contract `Ingredient` (prototype `{ ing, amt, unit }`). */
export interface IngredientRow {
  ingredient: string;
  /** Read with `num`, as the prototype reads its text box. */
  amount: number | string;
  /** `g`, `tsp` or `tbsp`; anything else counts as grams, as in the prototype. */
  unit: string;
}

/** Grams per unit. Mirrors prototype `UNIT_G`. */
export const UNIT_GRAMS: Readonly<Record<string, number>> = { g: 1, tsp: 5, tbsp: 15 };

/** Oil levels in the recipe builder. */
export type OilLevel = 'low' | 'normal' | 'rich';

/** Multiplier on fatty ingredients per oil level. Mirrors prototype `OIL_LEVEL`. */
export const OIL_LEVEL: Readonly<Record<OilLevel, number>> = { low: 0.5, normal: 1, rich: 2 };

/** Ingredients counted toward fruit and veg in a saved recipe (the list inline in prototype `case 'rb-save'`). */
export const RECIPE_VEG_INGREDIENTS: readonly string[] = ['Mixed vegetables', 'Spinach', 'Bhindi', 'Cauliflower', 'Green peas', 'Tomato', 'Onion', 'Capsicum', 'Cucumber'];

/** Grams of fruit or veg in one serving (the `/80` in prototype `case 'rb-save'`). */
export const FRUIT_VEG_SERVING_G = 80;

/** The ingredient counted as added sugar in a saved recipe (prototype `r.ing === 'Sugar'`). */
export const SUGAR_INGREDIENT = 'Sugar';

/**
 * Most personal foods kept after a recipe or kitchen-test save (prototype `.slice(0, 80)` in
 * `case 'rb-save'` and `ktSave`). The custom-food form keeps 60 (`MY_FOODS_MAX`).
 */
export const BUILT_FOODS_MAX = 80;

/** "Log now" katoris: limits and step (prototype `case 'rb-log'` and its ± buttons). */
export const RECIPE_LOG_MIN = 0.5;
export const RECIPE_LOG_MAX = 6;
export const RECIPE_LOG_STEP = 0.5;

const r1 = (n: number): number => Math.round(n * 10) / 10;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-IN');
const unitG = (unit: string): number => UNIT_GRAMS[unit] || 1;

/** Grams in an ingredient row: `num(amount) × UNIT_G[unit]` (1 for an unknown unit). Mirrors the `g` step of prototype `rbTotals` and `ktCalc`. */
export function ingredientGrams(row: IngredientRow): number {
  return num(row.amount) * unitG(row.unit);
}

/** Energy and macros of a whole recipe, unrounded. */
export interface RecipeTotals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Grams of rows whose ingredient is known. */
  grams: number;
}

/** Per-katori energy and macros, unrounded. */
export interface PerKatori {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** What `recipeTotals` reads: contract `Recipe` fields. */
export interface RecipeYield {
  ingredients: readonly IngredientRow[];
  yield_mode: 'katori' | 'grams';
  /** Katoris made, when `yield_mode` is katori. Read with `num`. */
  katoris: number | string | null;
  /** Cooked weight in grams, when `yield_mode` is grams (prototype `grams`). Read with `num`. */
  cooked_g: number | string | null;
}

/** Result of `recipeTotals`. */
export interface RecipeTotalsResult {
  total: RecipeTotals;
  /** Katoris made: as entered, or cooked grams ÷ `katoriG` (0 when not given). Show with r1. */
  katoris: number;
  /** Null until the yield is above 0. */
  perKatori: PerKatori | null;
}

/**
 * Whole-pot totals, katoris made and per-katori values. `raw` is content/raw-ingredients.json
 * `ingredients`; rows whose ingredient is not there are skipped. `katoriG` is content/recipes.json
 * `katori_g` (150): in grams mode the yield is `cooked_g / katoriG` katoris. Values are unrounded; the
 * prototype shows energy and macros with `fmt` (rounded) and katoris with r1.
 *
 * Mirrors prototype `rbTotals()` (recipe, `RAW` and `KATORI_G` passed in).
 */
export function recipeTotals(recipe: RecipeYield, raw: readonly RawIngredient[], katoriG: number): RecipeTotalsResult {
  return totalsWith(recipe, indexRaw(raw), katoriG);
}

function totalsWith(recipe: RecipeYield, table: ReadonlyMap<string, RawIngredient>, katoriG: number): RecipeTotalsResult {
  const t = { kcal: 0, p: 0, c: 0, f: 0, g: 0 };
  recipe.ingredients.forEach((r) => {
    const v = table.get(r.ingredient)?.per_100g;
    if (!v) return;
    const g = num(r.amount) * unitG(r.unit);
    t.g += g;
    t.kcal += (v.kcal * g) / 100;
    t.p += (v.protein_g * g) / 100;
    t.c += (v.carbs_g * g) / 100;
    t.f += (v.fat_g * g) / 100;
  });
  const kat = recipe.yield_mode === 'katori' ? num(recipe.katoris) : num(recipe.cooked_g) ? num(recipe.cooked_g) / katoriG : 0;
  const perKatori = kat > 0 ? { kcal: t.kcal / kat, protein_g: t.p / kat, carbs_g: t.c / kat, fat_g: t.f / kat } : null;
  return { total: { kcal: t.kcal, protein_g: t.p, carbs_g: t.c, fat_g: t.f, grams: t.g }, katoris: kat, perKatori };
}

/**
 * A preset's rows at an oil level: grams of fatty ingredients (`fatty` in `raw`) scaled by `OIL_LEVEL`,
 * every amount rounded to a whole gram, unit `g`. `rows` are content/recipes.json `presets[].ingredients`
 * (prototype `PRESETS[k].rows`, all in grams); a row in tsp or tbsp is turned into grams first. An
 * ingredient missing from `raw` is not fatty.
 *
 * Mirrors the rows step of prototype `rbFromPreset(k)` (also run by `case 'rb-oil'` when a preset is loaded).
 */
export function presetIngredients(rows: readonly IngredientRow[], oil: OilLevel, raw: readonly RawIngredient[]): IngredientRow[] {
  const m = OIL_LEVEL[oil], table = indexRaw(raw);
  return rows.map((r) => {
    const g = ingredientGrams(r);
    return { ingredient: r.ingredient, amount: Math.round(table.get(r.ingredient)?.fatty ? g * m : g), unit: 'g' };
  });
}

/** The "Log now" katoris after a ± press (`step` is +0.5 or -0.5), kept within 0.5–6. Mirrors prototype `case 'rb-log'`. */
export function stepRecipeLog(current: number, step: number | string): number {
  return Math.max(RECIPE_LOG_MIN, Math.min(RECIPE_LOG_MAX, current + num(step)));
}

/** What `recipeFood` reads: contract `Recipe` fields. */
export interface RecipeInput extends RecipeYield {
  name: string;
}

/** Result of `recipeFood`. */
export type RecipeFoodResult =
  /** "Give the recipe a name." */
  | { kind: 'no-name' }
  /** The trimmed name is over `FOOD_NAME_MAX` (200), the contract limit (as `customFood`, #150; the prototype saves it). */
  | { kind: 'name-too-long' }
  /** An ingredient amount below 0 (contract `Ingredient.amount`; as `customFood`, #150; the prototype saves it). */
  | { kind: 'invalid' }
  /** "Add at least one ingredient with an amount." */
  | { kind: 'no-ingredients' }
  /** "Add how many katoris it made, or the cooked weight." */
  | { kind: 'no-yield' }
  /**
   * The recipe's trimmed name, the rows to store (amount above 0) and the personal food it saves. The
   * "Save and log" button logs `food`'s values at the "Log now" katoris.
   */
  | { kind: 'ok'; name: string; ingredients: IngredientRow[]; food: UserFoodFields };

/**
 * Saving a recipe: checks, the rows kept and the personal food (unit "1 katori"): energy rounded,
 * macros, fibre, added sugar (grams of `Sugar` rows) and fruit and veg (grams of `RECIPE_VEG_INGREDIENTS`
 * rows ÷ 80) per katori, each to 0.1. Sugar and fruit and veg are read by ingredient name, whether or not
 * the name is in `raw`, as the prototype does. After the name checks, an amount below 0 gives `invalid`.
 *
 * Mirrors prototype `case 'rb-save'` (checks, `rec.rows` and `food`), plus `name-too-long` and `invalid` (#150).
 */
export function recipeFood(recipe: RecipeInput, raw: readonly RawIngredient[], katoriG: number): RecipeFoodResult {
  const table = indexRaw(raw);
  const { total, katoris: kat, perKatori: per } = totalsWith(recipe, table, katoriG);
  const name = recipe.name.trim();
  if (!name) return { kind: 'no-name' };
  if (name.length > FOOD_NAME_MAX) return { kind: 'name-too-long' };
  if (recipe.ingredients.some((r) => num(r.amount) < 0)) return { kind: 'invalid' };
  if (!total.grams) return { kind: 'no-ingredients' };
  if (!per) return { kind: 'no-yield' };
  const rows = recipe.ingredients;
  const fibT = rows.reduce((a, r) => a + ((table.get(r.ingredient)?.per_100g.fibre_g || 0) * num(r.amount) * unitG(r.unit)) / 100, 0);
  const sugT = rows.filter((r) => r.ingredient === SUGAR_INGREDIENT).reduce((a, r) => a + num(r.amount) * unitG(r.unit), 0);
  const vegG = rows.filter((r) => RECIPE_VEG_INGREDIENTS.includes(r.ingredient)).reduce((a, r) => a + num(r.amount) * unitG(r.unit), 0);
  return {
    kind: 'ok',
    name,
    ingredients: rows.filter((r) => num(r.amount) > 0),
    food: {
      name,
      unit: '1 katori',
      kcal: Math.round(per.kcal),
      protein_g: r1(per.protein_g),
      carbs_g: r1(per.carbs_g),
      fat_g: r1(per.fat_g),
      fibre_g: r1(fibT / kat),
      added_sugar_g: r1(sugT / kat),
      fruit_veg_servings: r1(vegG / FRUIT_VEG_SERVING_G / kat),
      origin: 'recipe',
    },
  };
}

/**
 * Personal foods after a recipe or kitchen-test save: `food` first, any food with its name (or, when an
 * edited recipe was renamed, `replacedName`) dropped, the first 80 kept. Pass the list newest first;
 * foods missing from the result are to be deleted.
 *
 * Mirrors the `S.settings.myFoods` step of prototype `case 'rb-save'` (`replacedName` is `old.name`) and of `ktSave`.
 */
export function saveBuiltFood<T extends { name: string }>(myFoods: readonly T[], food: T, replacedName?: string): T[] {
  return [food, ...myFoods.filter((x) => x.name !== food.name && (replacedName === undefined || x.name !== replacedName))].slice(0, BUILT_FOODS_MAX);
}

/** What `kitchenTest` reads: contract `KitchenTest` fields. Weights are read with `num`. */
export interface KitchenTestInput {
  ingredients: readonly IngredientRow[];
  /** Empty pot (prototype `pot`). */
  pot_g: number | string | null;
  /** Pot with food (prototype `potFull`). */
  pot_full_g: number | string | null;
  /** Cooked weight entered directly (prototype `cooked`); wins over the pot weights. */
  cooked_g: number | string | null;
  /** One serving (prototype `serving`). */
  serving_g: number | string | null;
}

/** Whole-dish totals of a kitchen test, unrounded. */
export interface KitchenTotals extends RecipeTotals {
  fibre_g: number;
  /** Grams of fatty ingredients (oil, ghee, butter, cream: `fatty` in the raw table). */
  oil_g: number;
}

/** Energy, macros and fibre for an amount of the cooked dish, unrounded. */
export interface KitchenAmount {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

/** One serving of a kitchen test, unrounded. */
export interface KitchenServing extends KitchenAmount {
  oil_g: number;
  /** The serving's weight. */
  grams: number;
}

/** Result of `kitchenTest`. */
export type KitchenTestResult =
  /** No cooked weight yet: "Add the cooked weight (or the pot weights) to see the results." */
  | { ready: false; total: KitchenTotals }
  | {
      ready: true;
      total: KitchenTotals;
      cooked_g: number;
      per100g: KitchenAmount;
      /** Null until a serving weight is given. */
      perServing: KitchenServing | null;
      /** Servings in the pot; null without a serving weight. Show with r1. */
      servings: number | null;
    };

/**
 * A kitchen test's results. `raw` is content/raw-ingredients.json `ingredients`. The cooked weight is
 * `cooked_g`, or else pot with food minus empty pot when pot with food is non-zero and the empty pot is
 * a number. An empty pot of 0 g counts (a tared scale, #214); a blank or non-numeric empty pot does not.
 * Not ready while the cooked weight is 0 or below. Values are unrounded; the prototype shows energy and
 * weights with `fmt` (rounded) and macros, fibre, oil and servings with r1.
 *
 * Mirrors prototype `ktCalc(d)` (`RAW`, `RAW_FIB` and `FATTY` passed in as `raw`).
 */
export function kitchenTest(test: KitchenTestInput, raw: readonly RawIngredient[]): KitchenTestResult {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, oil: 0, g: 0 };
  const table = indexRaw(raw);
  test.ingredients.forEach((r) => {
    const i = table.get(r.ingredient);
    if (!i) return;
    const v = i.per_100g;
    const g = num(r.amount) * unitG(r.unit);
    t.g += g;
    t.kcal += (v.kcal * g) / 100;
    t.p += (v.protein_g * g) / 100;
    t.c += (v.carbs_g * g) / 100;
    t.f += (v.fat_g * g) / 100;
    t.fib += ((v.fibre_g || 0) * g) / 100;
    if (i.fatty) t.oil += g;
  });
  const total: KitchenTotals = { kcal: t.kcal, protein_g: t.p, carbs_g: t.c, fat_g: t.f, fibre_g: t.fib, oil_g: t.oil, grams: t.g };
  // An empty pot of 0 g counts (a tared scale, #214); a blank or non-numeric box does not.
  const potWeighed = Number.isFinite(parseFloat(String(test.pot_g).replace(',', '.')));
  const cooked = num(test.cooked_g) || (num(test.pot_full_g) && potWeighed ? num(test.pot_full_g) - num(test.pot_g) : 0);
  const sv = num(test.serving_g);
  if (!cooked || cooked <= 0) return { ready: false, total };
  const k = 100 / cooked, s = sv ? sv / cooked : 0;
  return {
    ready: true,
    total,
    cooked_g: cooked,
    per100g: { kcal: t.kcal * k, protein_g: t.p * k, carbs_g: t.c * k, fat_g: t.f * k, fibre_g: t.fib * k },
    perServing: sv ? { kcal: t.kcal * s, protein_g: t.p * s, carbs_g: t.c * s, fat_g: t.f * s, fibre_g: t.fib * s, oil_g: t.oil * s, grams: sv } : null,
    servings: sv ? cooked / sv : null,
  };
}

/** What `kitchenTestFood` reads: contract `KitchenTest` fields. */
export interface KitchenTestFoodInput extends KitchenTestInput {
  name: string;
  /** Prototype `sname`: katori, plate, piece, glass or bowl. */
  serving_name: string;
}

/** Result of `kitchenTestFood`. */
export type KitchenTestFoodResult =
  /** "Name the dish." Nothing saved. */
  | { kind: 'no-name' }
  /** The trimmed name is over `FOOD_NAME_MAX` (200), the contract limit (as `customFood`, #150; the prototype saves it). Nothing saved. */
  | { kind: 'name-too-long' }
  /** An ingredient amount, pot, cooked or serving weight below 0 (contract minimums; as `customFood`, #150; the prototype saves it). Nothing saved. */
  | { kind: 'invalid' }
  /** "Add the raw ingredients with their weights." Nothing saved. */
  | { kind: 'no-ingredients' }
  /** "Add the cooked weight, or both pot weights." Nothing saved. */
  | { kind: 'not-ready' }
  /** "Weigh one serving first, so the app knows the portion." The test is saved (trimmed `name`); no food. */
  | { kind: 'no-serving'; name: string }
  /** The test is saved (trimmed `name`), and `food` replaces any personal food of that name. */
  | { kind: 'ok'; name: string; food: UserFoodFields };

/**
 * "Save and use for my logging": the checks, then the personal food per serving, unit
 * "1 <serving name> (<grams> g)" (grams rounded, en-IN digit grouping as prototype `fmt`), energy
 * rounded, macros and fibre to 0.1, added sugar 0, no fruit and veg data (null).
 *
 * After the name checks, an amount or weight below 0 gives `invalid`.
 *
 * Mirrors prototype `ktSave(true)` (checks and `food`), plus `name-too-long` and `invalid` (#150). Plain
 * "Save test" is the same checks without the serving one.
 */
export function kitchenTestFood(test: KitchenTestFoodInput, raw: readonly RawIngredient[]): KitchenTestFoodResult {
  const r = kitchenTest(test, raw);
  const name = test.name.trim();
  if (!name) return { kind: 'no-name' };
  if (name.length > FOOD_NAME_MAX) return { kind: 'name-too-long' };
  if (test.ingredients.some((x) => num(x.amount) < 0) || [test.pot_g, test.pot_full_g, test.cooked_g, test.serving_g].some((w) => num(w) < 0)) return { kind: 'invalid' };
  if (!r.total.grams) return { kind: 'no-ingredients' };
  if (!r.ready) return { kind: 'not-ready' };
  const ps = r.perServing;
  if (!ps) return { kind: 'no-serving', name };
  return {
    kind: 'ok',
    name,
    food: {
      name,
      unit: `1 ${test.serving_name} (${fmt(ps.grams)} g)`,
      kcal: Math.round(ps.kcal),
      protein_g: r1(ps.protein_g),
      carbs_g: r1(ps.carbs_g),
      fat_g: r1(ps.fat_g),
      fibre_g: r1(ps.fibre_g),
      added_sugar_g: 0,
      fruit_veg_servings: null,
      origin: 'kitchen_test',
    },
  };
}

/** The ingredient "Add 50 g soya chunks" adds, and the one that stops that suggestion (prototype `'Soya chunks'`). */
export const SOYA_INGREDIENT = 'Soya chunks';
/** Grams of soya chunks "Add 50 g soya chunks" adds (the `'50'` of prototype `case 'fit-soya'`). */
export const FIT_SOYA_G = 50;
/** Protein in `FIT_SOYA_G` of soya chunks, as the prototype states it (the `26` in `fitSuggestions`). */
export const FIT_SOYA_PROTEIN_G = 26;
/** Least kcal per katori that halving the oil must save before it is suggested (prototype `save >= 25`). */
export const FIT_OIL_MIN_SAVE_KCAL = 25;
/** A vegetarian recipe under this many grams of protein per katori gets the soya suggestion (prototype `per.p < 12`). */
export const FIT_PROTEIN_MIN_G = 12;

/** One "Make it fit" suggestion. */
export type FitSuggestion =
  /** "Use half the oil or ghee: about −N kcal per katori"; `kcal_saved` is unrounded (show with `fmt`). */
  | { kind: 'fit-oil'; kcal_saved: number }
  /** "Add 50 g soya chunks: about +N g protein per katori"; `protein_added_g` is unrounded (show with `fmt`). */
  | { kind: 'fit-soya'; protein_added_g: number };

/**
 * The recipe builder's "Make it fit" suggestions, in the prototype's order: none until the recipe has a yield.
 * Oil: the fatty rows with an amount above 0 total `g` grams; halving them saves `g / 2 × 9 / katoris` kcal
 * per katori, suggested from 25 up. Soya: a recipe with no ingredient containing "Chicken" or "Egg" (a
 * substring match, as the prototype's `/Chicken|Egg/`), under 12 g protein per katori and no Soya chunks row.
 * `raw` is content/raw-ingredients.json `ingredients` (an unknown ingredient is not fatty).
 *
 * Mirrors prototype `fitSuggestions()` (the `RB` passed in as `recipe`).
 */
export function fitSuggestions(recipe: RecipeYield, raw: readonly RawIngredient[], katoriG: number): FitSuggestion[] {
  const table = indexRaw(raw);
  const { perKatori, katoris } = totalsWith(recipe, table, katoriG);
  if (!perKatori) return [];
  const out: FitSuggestion[] = [];
  const fat = recipe.ingredients.filter((r) => table.get(r.ingredient)?.fatty && num(r.amount) > 0);
  if (fat.length) {
    const g = fat.reduce((a, r) => a + num(r.amount) * unitG(r.unit), 0);
    const save = ((g / 2) * 9) / katoris;
    if (save >= FIT_OIL_MIN_SAVE_KCAL) out.push({ kind: 'fit-oil', kcal_saved: save });
  }
  const veg = !recipe.ingredients.some((r) => /Chicken|Egg/.test(r.ingredient));
  if (veg && perKatori.protein_g < FIT_PROTEIN_MIN_G && !recipe.ingredients.some((r) => r.ingredient === SOYA_INGREDIENT)) {
    out.push({ kind: 'fit-soya', protein_added_g: FIT_SOYA_PROTEIN_G / katoris });
  }
  return out;
}

/**
 * The rows after "Apply" on a suggestion. `fit-oil` halves every fatty row's amount, rounded to a whole
 * number, unit kept (also a row whose amount is 0 or blank, which becomes "0"); `fit-soya` adds 50 g of
 * Soya chunks. Amounts come back as text, as the prototype's text boxes hold them.
 *
 * Mirrors prototype `case 'fit-oil'` and `case 'fit-soya'` of `food3Action`.
 */
export function applyFit(kind: FitSuggestion['kind'], rows: readonly IngredientRow[], raw: readonly RawIngredient[]): IngredientRow[] {
  if (kind === 'fit-soya') return [...rows.map((r) => ({ ...r })), { ingredient: SOYA_INGREDIENT, amount: String(FIT_SOYA_G), unit: 'g' }];
  const table = indexRaw(raw);
  return rows.map((r) => (table.get(r.ingredient)?.fatty ? { ...r, amount: String(Math.round(num(r.amount) / 2)) } : { ...r }));
}

/** A kitchen test as the table and the comparison read it: contract `KitchenTest` fields. */
export interface KitchenTestRecord extends KitchenTestInput {
  name: string;
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  note: string;
  serving_name: string;
}

/**
 * "Copy all as a table": tab-separated text, a header line then one line per test in the order given. Columns:
 * dish, date, notes, cooked_g (rounded, 0 when not ready), serving, serving_g, kcal_per_serving (rounded),
 * protein, carbs, fat, fibre and oil per serving (to 0.1; a test with no serving gives an empty serving_g and
 * zeros), and the ingredients with a non-zero amount (a negative one is listed too) as "name 80g; name 1tsp". Text is not escaped, as in the prototype.
 *
 * Mirrors prototype `ktExport()` (the text it copies).
 */
export function kitchenTable(tests: readonly KitchenTestRecord[], raw: readonly RawIngredient[]): string {
  const head = 'dish\tdate\tnotes\tcooked_g\tserving\tserving_g\tkcal_per_serving\tprotein_g\tcarbs_g\tfat_g\tfibre_g\toil_g_per_serving\tingredients';
  const lines = tests.map((t) => {
    const r = kitchenTest(t, raw);
    const ps = r.ready ? r.perServing : null;
    return [
      t.name,
      t.date,
      t.note,
      Math.round(r.ready ? r.cooked_g : 0),
      t.serving_name,
      ps ? ps.grams : '',
      Math.round(ps ? ps.kcal : 0),
      r1(ps ? ps.protein_g : 0),
      r1(ps ? ps.carbs_g : 0),
      r1(ps ? ps.fat_g : 0),
      r1(ps ? ps.fibre_g : 0),
      r1(ps ? ps.oil_g : 0),
      t.ingredients.filter((x) => num(x.amount)).map((x) => `${x.ingredient} ${x.amount}${x.unit}`).join('; '),
    ].join('\t');
  });
  return [head, ...lines].join('\n');
}

/** A food the kitchen-test comparison can read: a personal food or a built-in one. */
export interface KitchenCompareFood {
  name: string;
  unit: string;
  kcal: number;
}

/** The app's current value for a dish, and how the weighed serving differs from it. */
export interface KitchenComparison {
  food: KitchenCompareFood;
  /** Serving kcal minus the food's kcal, unrounded: positive when the dish has more. Show the sign and `fmt` of the absolute value. */
  diff_kcal: number;
}

/**
 * Compares a kitchen test's serving with the food of the same name (case-insensitive, whole name, not trimmed;
 * the first match, so `foods` lists personal foods before built-in ones). Null without a serving or a match.
 *
 * Mirrors the `cmp` of prototype `ktResultHtml(d)` (`foods` is `allFoods()`).
 */
export function kitchenCompare(name: string, perServing: KitchenServing | null, foods: readonly KitchenCompareFood[]): KitchenComparison | null {
  if (!perServing) return null;
  const n = String(name || '').toLowerCase();
  const food = foods.find((f) => f.name.toLowerCase() === n);
  return food ? { food, diff_kcal: perServing.kcal - food.kcal } : null;
}

/**
 * The minutes a cooking step asks for: the first number right before "min" ("cook for 12 min", "5min"), or
 * null. Mirrors the `match(/(\d+)\s*min/)` of prototype `cookSheet`.
 */
export function stepMinutes(step: string): number | null {
  const m = /(\d+)\s*min/.exec(step);
  return m ? Number(m[1]) : null;
}
