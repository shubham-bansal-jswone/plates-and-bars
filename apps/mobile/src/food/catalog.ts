import type { FoodFacts, GramsFood, SearchableFood } from '@plate-and-bar/core';
import eatout from '../../../../content/eatout.json';
import foods from '../../../../content/foods.json';
import { contentReader, isArrOf, isNum, isNumOrNull, isObj, isStr, isStrOrNull } from '../content/reader';

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

/** Shape check for one food row: every key the screens and core read, with its type. */
export function isCatalogFood(v: unknown): v is CatalogFood {
  if (!isObj(v) || !isStr(v.name) || !(v.id === undefined || isStrOrNull(v.id))) return false;
  if (!(v.aliases === undefined || isArrOf(v.aliases, isStr))) return false;
  const s = v.serving;
  const p = v.per_serving;
  return (
    isObj(s) && isStr(s.label) && isNumOrNull(s.grams) &&
    isObj(p) && isNum(p.kcal) && isNum(p.protein_g) && isNum(p.carbs_g) && isNum(p.fat_g) && isNumOrNull(p.fibre_g) && isNumOrNull(p.added_sugar_g) &&
    isNumOrNull(v.fruit_veg_servings)
  );
}

const isCuisine = (v: unknown): v is Cuisine => isObj(v) && isStr(v.name) && isArrOf(v.tips, isStr) && isArrOf(v.dishes, isCatalogFood);

interface FoodsBundle { foods: CatalogFood[] }
interface EatoutBundle { cuisines: Cuisine[] }
const isFoods = (v: unknown): v is FoodsBundle => isObj(v) && isArrOf(v.foods, isCatalogFood) && v.foods.length > 0;
const isEatout = (v: unknown): v is EatoutBundle => isObj(v) && isArrOf(v.cuisines, isCuisine) && v.cuisines.length > 0;

/** The food catalog: the server copy chosen at app start when its shape holds, else the shipped foods.json. Call it where it is used, not at module level. */
export const getFoodCatalog = contentReader('foods', foods as unknown as FoodsBundle, isFoods, (b) => b.foods);

/** The eating-out cuisines, resolved the same way from eatout.json. */
export const getCuisines = contentReader('eatout', eatout as unknown as EatoutBundle, isEatout, (b) => b.cuisines);
