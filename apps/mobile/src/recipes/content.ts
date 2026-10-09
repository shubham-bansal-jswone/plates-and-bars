import type { IngredientRow, RawIngredient } from '@plate-and-bar/core';
import recipes from '../../../../content/recipes.json';
import raw from '../../../../content/raw-ingredients.json';

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

/** content/recipes.json `katori_g`: grams in one katori. */
export const katoriG: number = recipes.katori_g;
/** The typical home-style starting points (prototype `PRESETS`). */
export const presets = recipes.presets as unknown as RecipeContent[];
/** The recipe library with steps (prototype `LIBRARY`). */
export const library = recipes.library as unknown as RecipeContent[];
/** content/raw-ingredients.json `ingredients` (prototype `RAW`, `RAW_FIB`, `FATTY`). */
export const rawIngredients = raw.ingredients as unknown as RawIngredient[];
