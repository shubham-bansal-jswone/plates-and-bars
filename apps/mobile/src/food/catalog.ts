import type { FoodFacts, GramsFood, SearchableFood } from '@plate-and-bar/core';
import foods from '../../../../content/foods.json';

/** A bundled food (content/foods.json `Food`), reduced to what the screen reads. */
export interface CatalogFood extends SearchableFood, GramsFood, FoodFacts {
  id: string | null;
  serving: { label: string; grams: number | null };
  per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number | null; added_sugar_g: number | null };
}

export const catalogFoods = foods.foods as unknown as CatalogFood[];
