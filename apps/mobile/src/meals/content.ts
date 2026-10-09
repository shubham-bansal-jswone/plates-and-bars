import type { GroceryEntry, MealPlanningContent } from '@plate-and-bar/core';
import planning from '../../../../content/meal-planning.json';

/** content/meal-planning.json: meal and protein weights, portion caps and food roles (the grocery map is read by the plan screen). */
export const mealPlanning = planning as unknown as MealPlanningContent;

/** content/meal-planning.json `grocery`: the raw amounts bought per serving of a food. */
export const mealGrocery = planning.grocery as unknown as GroceryEntry[];
