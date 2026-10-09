import type { FoodFacts, GramsFood, SearchableFood } from '@plate-and-bar/core';
import eatout from '../../../../content/eatout.json';
import foods from '../../../../content/foods.json';
import { contentReader, isArrOf, isNumIn, isObj, isStr, isStrOrNull, isText, isUuid, perLoad } from '../content/reader';

/** A bundled food (content/foods.json `Food`), reduced to what the screen reads. */
export interface CatalogFood extends SearchableFood, GramsFood, FoodFacts {
  id: string | null;
  serving: { label: string; grams: number | null };
  per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number | null; added_sugar_g: number | null };
}

/** One eating-out cuisine (content/eatout.json): smart-pick tips and dishes in the food row shape. */
export interface Cuisine {
  name: string;
  tips: string[];
  dishes: CatalogFood[];
}

/** A food source as recorded on a row (contract `FoodSource`); About lists these. */
export interface FoodSource { code: string; name: string; licence: string; url: string | null; reference?: string | null }

// Bounds: the contract's (`Food`, `Nutrients`, `Serving`, `FoodLog.name` maxLength 200) plus generous upper limits for
// values the contract leaves open (shipped maxima: kcal 700, macros 85 g, serving 150 g, fruit and veg 2).
const KCAL_MAX = 5000;
const G_MAX = 1000;
const SERVING_G_MAX = 10000;
const FV_MAX = 50;
const NAME_MAX = 200;

const num = isNumIn(0, G_MAX);
const numOrNull = (v: unknown): v is number | null => v === null || num(v);
const isSource = (v: unknown): v is FoodSource =>
  isObj(v) && isText(NAME_MAX)(v.code) && isText(1000)(v.name) && isText(NAME_MAX)(v.licence) && isStrOrNull(v.url) && (v.reference === undefined || isStrOrNull(v.reference));

/** Shape and bounds of one food row: the whole `Food` the contract requires, as far as the app and core read or sync it. */
export function isCatalogFood(v: unknown): v is CatalogFood & { source: FoodSource } {
  if (!isObj(v) || !isUuid(v.id) || !isText(NAME_MAX)(v.name) || !(v.name_hi === undefined || isStrOrNull(v.name_hi))) return false;
  if (!isArrOf(v.aliases, isStr) || !isSource(v.source) || !isStr(v.updated_at)) return false;
  const s = v.serving;
  const p = v.per_serving;
  return (
    isObj(s) && isStr(s.label) && s.label.length <= NAME_MAX && (s.grams === null || (isNumIn(0, SERVING_G_MAX)(s.grams) && s.grams > 0)) &&
    isObj(p) && isNumIn(0, KCAL_MAX)(p.kcal) && num(p.protein_g) && num(p.carbs_g) && num(p.fat_g) && numOrNull(p.fibre_g) && numOrNull(p.added_sugar_g) &&
    isNumIn(0, FV_MAX)(v.fruit_veg_servings)
  );
}

type Row = CatalogFood & { source: FoodSource };
interface Cuis { name: string; tips: string[]; dishes: Row[] }
const isCuisine = (v: unknown): v is Cuis => isObj(v) && isText(NAME_MAX)(v.name) && isArrOf(v.tips, isStr) && isArrOf(v.dishes, isCatalogFood) && v.dishes.length > 0;

interface FoodsBundle { foods: Row[] }
interface EatoutBundle { cuisines: Cuis[] }
const shippedFoods = foods as unknown as FoodsBundle;
const shippedNames = shippedFoods.foods.map((f) => f.name);

/**
 * A stored foods copy must be valid in every row and keep every food the shipped copy has: past-day totals and the core
 * meal rules (MAIN_CARBS, SIDE_SETS, FAST_PROTEINS) look foods up by name. Additions and value edits are fine; a removed or
 * renamed food rejects the whole copy.
 */
const isFoods = (v: unknown): v is FoodsBundle => {
  if (!isObj(v) || !isArrOf(v.foods, isCatalogFood) || v.foods.length === 0) return false;
  const have = new Set(v.foods.map((f) => f.name));
  return shippedNames.every((n) => have.has(n));
};
const isEatout = (v: unknown): v is EatoutBundle => isObj(v) && isArrOf(v.cuisines, isCuisine) && v.cuisines.length > 0;

/** The single accept or reject decision for the foods and eatout bundles: the catalog and About sources both read these. */
export const chosenFoods = contentReader('foods', shippedFoods, isFoods);
export const chosenEatout = contentReader('eatout', eatout as unknown as EatoutBundle, isEatout);

/** The food catalog. Call it where it is used, not at module level. */
export const getFoodCatalog: () => CatalogFood[] = perLoad(() => chosenFoods().foods);

/** The eating-out cuisines, from the same decision as the sources. */
export const getCuisines: () => Cuisine[] = perLoad(() => chosenEatout().cuisines);
