import type { SyncMeta } from '../setup/types';

/** Contract `Ingredient`. */
export interface Ingredient {
  ingredient: string;
  amount: number;
  unit: string;
}

/** Contract `Recipe`. */
export interface Recipe extends SyncMeta {
  name: string;
  ingredients: Ingredient[];
  yield_mode: 'katori' | 'grams';
  katoris: number | null;
  cooked_g: number | null;
  oil: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isIngredient = (x: unknown): x is Ingredient => isObj(x) && typeof x.ingredient === 'string' && isNum(x.amount) && typeof x.unit === 'string';

/** Shape check for a recipe read back from storage (a damaged or foreign row is skipped, not trusted). */
export function isRecipe(x: unknown): x is Recipe {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.updated_at === 'string' &&
    isNum(x.version) &&
    Array.isArray(x.ingredients) &&
    x.ingredients.every(isIngredient) &&
    (x.yield_mode === 'katori' || x.yield_mode === 'grams') &&
    (x.katoris === null || isNum(x.katoris)) &&
    (x.cooked_g === null || isNum(x.cooked_g)) &&
    typeof x.oil === 'string'
  );
}
