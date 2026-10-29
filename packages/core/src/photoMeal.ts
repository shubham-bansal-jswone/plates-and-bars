/**
 * Meal photo rules (#1011): the clamps and maths the prototype applies to an AI photo answer. Pure; the app keeps the food
 * lookup and the screens. Prototype functions: `analysePhoto` (prototype-final tag), `phMacros`,
 * `photoAction` `ph-add` and the portion slider in `renderFoodSheet`.
 */
import { num } from './num';
import { round1 } from './progress';

/** Items kept from one answer: `raw.slice(0, 12)` (prototype). */
export const PHOTO_ITEMS_MAX = 12;
/** Servings clamp `Math.min(6, Math.max(0.25, num(i.servings) || 1))` (prototype). */
export const PHOTO_SERVINGS_MIN = 0.25;
export const PHOTO_SERVINGS_MAX = 6;
/** Portion slider `min="0.5" max="2" step="0.25"` (prototype). */
export const PHOTO_ADJ_MIN = 0.5;
export const PHOTO_ADJ_MAX = 2;
export const PHOTO_ADJ_STEP = 0.25;

/** Macros of one item; `protein_g`, `carbs_g`, `fat_g` are the prototype's `p`, `c`, `f`. */
export interface PhotoMacros {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** The first 12 items of an answer (prototype `raw.slice(0, 12)`). */
export function capPhotoItems<T>(items: readonly T[]): T[] {
  return items.slice(0, PHOTO_ITEMS_MAX);
}

/** Servings of a matched food: `Math.min(6, Math.max(0.25, num(servings) || 1))` (prototype `analysePhoto`). 0 or junk reads as 1. */
export function clampPhotoServings(servings: unknown): number {
  return Math.min(PHOTO_SERVINGS_MAX, Math.max(PHOTO_SERVINGS_MIN, num(servings) || 1));
}

/** The portion adjuster one step up or down, within 0.5 to 2 (the prototype range input). */
export function stepPhotoAdj(adj: number, dir: 1 | -1): number {
  return Math.min(PHOTO_ADJ_MAX, Math.max(PHOTO_ADJ_MIN, adj + dir * PHOTO_ADJ_STEP));
}

/** Macros shown for an item: base times `mult * adj`, unrounded (prototype `phMacros`). */
export function photoMacros(base: PhotoMacros, mult: number, adj: number): PhotoMacros {
  const k = mult * adj;
  return { kcal: base.kcal * k, protein_g: base.protein_g * k, carbs_g: base.carbs_g * k, fat_g: base.fat_g * k };
}

/** Quantity logged for a food from the list: `r1(it.mult * it.adj)` (prototype `ph-add`). */
export function photoLogQty(mult: number, adj: number): number {
  return round1(mult * adj);
}

/** Numbers logged (and saved to my foods) for an estimate: kcal to a whole number, the rest to 1 decimal (prototype `ph-add`). */
export function photoEstimateLog(base: PhotoMacros, mult: number, adj: number): PhotoMacros {
  const m = photoMacros(base, mult, adj);
  return { kcal: Math.round(m.kcal), protein_g: round1(m.protein_g), carbs_g: round1(m.carbs_g), fat_g: round1(m.fat_g) };
}

/** The adjuster number: `r1(it.adj)`, shown as "1.5×" beside the slider (prototype) and as the " ×1.5" suffix of a saved food's unit (`ph-add`). */
export const photoAdjLabel = (adj: number): number => round1(adj);
