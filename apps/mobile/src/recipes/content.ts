import type { IngredientRow, RawIngredient } from '@plate-and-bar/core';
import recipes from '../../../../content/recipes.json';
import raw from '../../../../content/raw-ingredients.json';
import { contentReader, isArrOf, isBool, isFoodSource, isNumIn, isObj, isStr, isTrimmedText, isUuid, perLoad, type FoodSource } from '../content/reader';

/** A bundled recipe (content/recipes.json `library` or `presets`), reduced to what the screens read. */
export interface RecipeContent {
  name: string;
  ingredients: IngredientRow[];
  katoris: number;
  time_min?: number;
  cost?: string;
  tags?: string;
  steps?: string[];
}

// Bounds: the contract's (`Ingredient`: amount > 0, unit g/tsp/tbsp; `Nutrients`; name maxLength 200) plus generous upper
// limits for values it leaves open (shipped maxima: raw kcal 884, amount 500 g, katoris 6, time 35 min, step 79 characters).
const NAME_MAX = 200;
const KCAL_MAX = 5000;
const G_MAX = 1000;
const AMOUNT_MAX = 10000;
const KATORIS_MAX = 100;
const KATORI_G_MAX = 2000;
const TIME_MAX = 1440;
const TEXT_MAX = 1000;
const per = isNumIn(0, G_MAX);
const positive = (max: number) => (v: unknown): v is number => isNumIn(0, max)(v) && v > 0;

type Src = { id: string; source: FoodSource };
type RawRow = RawIngredient & Src & { aliases: string[] };
type RecipeRow = RecipeContent & Src;
interface RawBundle { ingredients: RawRow[] }
interface RecipesBundle { katori_g: number; presets: RecipeRow[]; library: RecipeRow[] }

const normName = (s: string): string => s.trim().toLowerCase();
const nonBlank = isTrimmedText;
/** Names must be unique after trim and lowercase, as `tools/validate/recipes.mjs` requires (the chips and picker key on them). */
const uniqueBy = (rows: readonly { name: string; id: string }[], key: (r: { name: string; id: string }) => string): boolean => new Set(rows.map(key)).size === rows.length;
const uniqueNames = (rows: readonly { name: string; id: string }[]): boolean => uniqueBy(rows, (r) => normName(r.name)) && uniqueBy(rows, (r) => r.id);
/** Source as `tools/validate/recipes.mjs` checks it: `isFoodSource`, plus url and reference present (string or null) and not blank. */
const isRowSource = (v: unknown): v is FoodSource =>
  isFoodSource(v) && isObj(v) && 'url' in v && 'reference' in v && (v.reference === null || nonBlank(200)(v.reference)) && (v.url === null || nonBlank(2000)(v.url));
const UPDATED_AT = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;
const KCAL_TOLERANCE = (kcal: number): number => Math.max(15, kcal * 0.15);

/**
 * One raw-ingredient row (per 100 g), as strict as `tools/validate/recipes.mjs` `validateRaw`, except that unknown extra fields
 * are allowed (a newer server may add them) and name lengths are capped (contract).
 */
const isRawRow = (v: unknown): v is RawRow => {
  if (!isObj(v) || !isUuid(v.id) || !nonBlank(NAME_MAX)(v.name) || !(v.name_hi === null || nonBlank(NAME_MAX)(v.name_hi))) return false;
  if (!isArrOf(v.aliases, nonBlank(NAME_MAX)) || !isBool(v.fatty) || !isBool(v.needs_dietitian_review) || !isRowSource(v.source)) return false;
  if (!isStr(v.updated_at) || !UPDATED_AT.test(v.updated_at)) return false;
  const p = v.per_100g;
  if (!isObj(p) || !isNumIn(0, KCAL_MAX)(p.kcal) || !per(p.protein_g) || !per(p.carbs_g) || !per(p.fat_g) || !per(p.fibre_g)) return false;
  // Macros fit in 100 g, fibre is part of carbs, kcal matches 4/4/9 within the tool's tolerance.
  return p.protein_g + p.carbs_g + p.fat_g <= 100.05 && p.fibre_g <= p.carbs_g && Math.abs(4 * p.protein_g + 4 * p.carbs_g + 9 * p.fat_g - p.kcal) <= KCAL_TOLERANCE(p.kcal);
};

const shippedRaw = raw as unknown as RawBundle;
const shippedNames = shippedRaw.ingredients.map((i) => i.name);
const shippedNameSet = new Set(shippedNames);

/**
 * A stored raw-ingredients copy must be valid in every row, have unique names (and ids, and no alias that is another row's
 * name), and keep every ingredient the shipped copy has: recipes, the builder's default rows and the kitchen test look
 * ingredients up by name. Additions and value edits are fine; a removed or renamed ingredient rejects the whole copy.
 */
const isRaw = (v: unknown): v is RawBundle => {
  if (!isObj(v) || !isArrOf(v.ingredients, isRawRow) || v.ingredients.length === 0) return false;
  const rows = v.ingredients;
  if (!uniqueNames(rows)) return false;
  const have = new Set(rows.map((i) => normName(i.name)));
  if (rows.some((i) => i.aliases.some((a) => normName(a) !== normName(i.name) && have.has(normName(a))))) return false;
  const exact = new Set(rows.map((i) => i.name));
  return shippedNames.every((n) => exact.has(n));
};

const isIngredient = (v: unknown): v is IngredientRow =>
  isObj(v) && isStr(v.ingredient) && shippedNameSet.has(v.ingredient) && positive(AMOUNT_MAX)(v.amount) && isStr(v.unit) && ['g', 'tsp', 'tbsp'].includes(v.unit);

/** A preset gets " (home-style)" appended when loaded in the builder (`draft.ts`), and a saved name is at most 200 characters. */
const HOME_STYLE_SUFFIX = ' (home-style)'.length;
const COSTS = ['Low', 'Medium', 'High'];

/**
 * One recipe row, as strict as `validateRecipes`: library rows need time, cost, tags and steps; no ingredient repeats in a
 * recipe. Its ingredients must be ones every accepted raw copy has (the shipped names), so a recipe never names an
 * ingredient the chosen raw table lacks, whichever of the two bundles was stored.
 */
const isRecipeRow = (kind: 'library' | 'preset') => (v: unknown): v is RecipeRow => {
  if (!isObj(v) || !isUuid(v.id) || !nonBlank(kind === 'preset' ? NAME_MAX - HOME_STYLE_SUFFIX : NAME_MAX)(v.name) || v.kind !== kind) return false;
  if (!isArrOf(v.ingredients, isIngredient) || v.ingredients.length === 0 || new Set(v.ingredients.map((i) => i.ingredient)).size !== v.ingredients.length) return false;
  if (!positive(KATORIS_MAX)(v.katoris) || !isRowSource(v.source) || typeof v.needs_dietitian_review !== 'boolean') return false;
  if (!isStr(v.updated_at) || !UPDATED_AT.test(v.updated_at)) return false;
  if (kind === 'preset') return true;
  return positive(TIME_MAX)(v.time_min) && isStr(v.cost) && COSTS.includes(v.cost) && nonBlank(TEXT_MAX)(v.tags) &&
    isArrOf(v.steps, nonBlank(TEXT_MAX)) && v.steps.length > 0;
};

const isRecipes = (v: unknown): v is RecipesBundle =>
  isObj(v) && positive(KATORI_G_MAX)(v.katori_g) &&
  isArrOf(v.presets, isRecipeRow('preset')) && v.presets.length > 0 && uniqueNames(v.presets) &&
  isArrOf(v.library, isRecipeRow('library')) && v.library.length > 0 && uniqueNames(v.library);

/** The single accept or reject decision for the recipes and raw-ingredients bundles: the builder, the kitchen test and About sources all read these. */
export const chosenRecipes = contentReader('recipes', recipes as unknown as RecipesBundle, isRecipes);
export const chosenRaw = contentReader('raw-ingredients', shippedRaw, isRaw);

/** content/recipes.json `katori_g`: grams in one katori. Call it where it is used, not at module level. */
export const getKatoriG: () => number = perLoad(() => chosenRecipes().katori_g);
/** The typical home-style starting points (prototype `PRESETS`). */
export const getPresets: () => RecipeContent[] = perLoad(() => chosenRecipes().presets);
/** The recipe library with steps (prototype `LIBRARY`). */
export const getLibrary: () => RecipeContent[] = perLoad(() => chosenRecipes().library);
/** content/raw-ingredients.json `ingredients` (prototype `RAW`, `RAW_FIB`, `FATTY`). */
export const getRawIngredients: () => RawIngredient[] = perLoad(() => chosenRaw().ingredients);
/**
 * The ingredient names the picker offers: every name in the CHOSEN raw table, so a server-added ingredient can be picked.
 * A saved recipe or kitchen test keeps only the name, so a later copy that drops it leaves a row core cannot find (core skips
 * it): `unknownIngredients` finds those rows, the screens mark them "not counted" and block saving while one is present.
 * Recipe content rows (presets, library) still use shipped names only, so content never depends on an added ingredient.
 */
export const getRawNames: () => readonly string[] = perLoad(() => getRawIngredients().map((i) => i.name));
/** The shipped ingredient names, whatever raw copy is chosen: the kitchen-test picker offers only these (a saved test keeps just the name and has no not-counted guard). */
export const getShippedRawNames = (): readonly string[] => shippedNames;
const knownNames = perLoad(() => new Set(getRawNames()));
/** The distinct ingredient names in `rows` that the chosen raw table lacks (own lookup in a Set, so no prototype names match). */
export const unknownIngredients = (rows: readonly { ingredient: string }[]): string[] => {
  const known = knownNames();
  return [...new Set(rows.map((r) => r.ingredient).filter((n) => !known.has(n)))];
};
