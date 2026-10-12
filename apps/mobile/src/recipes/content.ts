import type { IngredientRow, RawIngredient } from '@plate-and-bar/core';
import recipes from '../../../../content/recipes.json';
import raw from '../../../../content/raw-ingredients.json';
import { contentReader, isArrOf, isBool, isFoodSource, isNumIn, isObj, isStr, isStrOrNull, isText, isUuid, perLoad, type FoodSource } from '../content/reader';

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
const perOrNull = (v: unknown): v is number | null => v === null || per(v);
const positive = (max: number) => (v: unknown): v is number => isNumIn(0, max)(v) && v > 0;

type Src = { source: FoodSource };
type RawRow = RawIngredient & Src;
type RecipeRow = RecipeContent & Src;
interface RawBundle { ingredients: RawRow[] }
interface RecipesBundle { katori_g: number; presets: RecipeRow[]; library: RecipeRow[] }

/** One raw-ingredient row (`per 100 g`): the whole row the contract and the content spec require, as far as the app and core read or sync it. */
const isRawRow = (v: unknown): v is RawRow => {
  if (!isObj(v) || !isUuid(v.id) || !isText(NAME_MAX)(v.name) || !(v.name_hi === undefined || (isStrOrNull(v.name_hi) && (v.name_hi === null || v.name_hi.length <= NAME_MAX)))) return false;
  if (!isArrOf(v.aliases, isStr) || !isBool(v.fatty) || !isFoodSource(v.source) || !isStr(v.updated_at)) return false;
  const p = v.per_100g;
  return isObj(p) && isNumIn(0, KCAL_MAX)(p.kcal) && per(p.protein_g) && per(p.carbs_g) && per(p.fat_g) && perOrNull(p.fibre_g);
};

const shippedRaw = raw as unknown as RawBundle;
const shippedNames = shippedRaw.ingredients.map((i) => i.name);
const shippedNameSet = new Set(shippedNames);

/**
 * A stored raw-ingredients copy must be valid in every row and keep every ingredient the shipped copy has: recipes, the
 * builder's default rows and the kitchen test look ingredients up by name. Additions and value edits are fine; a removed or
 * renamed ingredient rejects the whole copy.
 */
const isRaw = (v: unknown): v is RawBundle => {
  if (!isObj(v) || !isArrOf(v.ingredients, isRawRow) || v.ingredients.length === 0) return false;
  const have = new Set(v.ingredients.map((i) => i.name));
  return shippedNames.every((n) => have.has(n));
};

const isIngredient = (v: unknown): v is IngredientRow =>
  isObj(v) && isStr(v.ingredient) && shippedNameSet.has(v.ingredient) && positive(AMOUNT_MAX)(v.amount) && isStr(v.unit) && ['g', 'tsp', 'tbsp'].includes(v.unit);

/**
 * One recipe row. Its ingredients must be ones every accepted raw copy has (the shipped names), so a recipe never names an
 * ingredient the chosen raw table lacks, whichever of the two bundles was stored.
 */
const isRecipeRow = (kind: 'library' | 'preset') => (v: unknown): v is RecipeRow =>
  isObj(v) && isUuid(v.id) && isText(NAME_MAX)(v.name) && v.kind === kind && isArrOf(v.ingredients, isIngredient) && v.ingredients.length > 0 &&
  positive(KATORIS_MAX)(v.katoris) && isFoodSource(v.source) && isStr(v.updated_at) &&
  (v.time_min === undefined || positive(TIME_MAX)(v.time_min)) &&
  (v.cost === undefined || isText(TEXT_MAX)(v.cost)) &&
  (v.tags === undefined || isText(TEXT_MAX)(v.tags)) &&
  (v.steps === undefined || isArrOf(v.steps, isText(TEXT_MAX)));

const isRecipes = (v: unknown): v is RecipesBundle =>
  isObj(v) && positive(KATORI_G_MAX)(v.katori_g) &&
  isArrOf(v.presets, isRecipeRow('preset')) && v.presets.length > 0 && isArrOf(v.library, isRecipeRow('library')) && v.library.length > 0;

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
/** The raw ingredient names, for the ingredient picker. */
export const getRawNames: () => string[] = perLoad(() => getRawIngredients().map((i) => i.name));
