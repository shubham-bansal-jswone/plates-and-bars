import { customFood, num, type CustomFoodResult } from '@plate-and-bar/core';
import type { Schemas } from '@plate-and-bar/api';
import type { CatalogFood } from '../food/catalog';
import { logOf, type NewLog } from '../food/useFoodDay';

/*
 * The clamps and maths below (servings 0.25 to 6, 12 items, the 0.5 to 2 adjuster, `phMacros`, the 1-decimal qty) are the
 * prototype's `analysePhoto` / `phMacros` / `ph-add` rules. They belong in packages/core with prototype golden numbers; the move
 * is tracked in #1011 (the app lane cannot edit core).
 */

/** Items kept from one answer (prototype `raw.slice(0, 12)`; the contract's `maxItems`). */
export const PHOTO_ITEMS_MAX = 12;
/** Servings of a matched food the model may report (prototype clamp 0.25 to 6; the contract's `servings` bounds). */
export const PHOTO_SERVINGS_MIN = 0.25;
export const PHOTO_SERVINGS_MAX = 6;
/** The portion adjuster on each item (prototype: a slider from 0.5 to 2 in steps of 0.25). */
export const PHOTO_ADJ_MIN = 0.5;
export const PHOTO_ADJ_MAX = 2;
export const PHOTO_ADJ_STEP = 0.25;

export interface Macros {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** One suggested item the user checks. `food` is the matched food (its macros are used), null for the model's own estimate. */
export interface PhotoRow {
  key: number;
  name: string;
  portion: string;
  food: CatalogFood | null;
  /** Servings of `food` the photo shows (1 for an estimate, whose `base` is already for the whole portion). */
  mult: number;
  /** The user's portion adjuster. */
  adj: number;
  unsure: boolean;
  /** The user typed in the name field (prototype `it.renamed`); it stays set after a swap, as there. */
  renamed: boolean;
  base: Macros;
}

type Item = Schemas['MealPhotoItem'];

/**
 * The rows to check, from the answer. An item whose `match` is a food on the device (by name, any case; the user's own foods
 * count) uses that food's macros times `servings` (clamped 0.25 to 6); any other uses its own numbers (prototype
 * `analysePhoto`). Never more than 12.
 */
export function rowsFromItems(items: readonly Item[], foods: readonly CatalogFood[]): PhotoRow[] {
  const byName = new Map<string, CatalogFood>();
  for (const f of foods) if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f);
  return items.slice(0, PHOTO_ITEMS_MAX).map((i, key) => {
    const food = i.match ? byName.get(i.match.toLowerCase()) ?? null : null;
    const unsure = i.confidence === 'low';
    if (food) return { key, name: food.name, portion: i.qty || food.serving.label, food, mult: Math.min(PHOTO_SERVINGS_MAX, Math.max(PHOTO_SERVINGS_MIN, num(i.servings) || 1)), adj: 1, unsure, renamed: false, base: food.per_serving };
    return { key, name: i.name || 'Item', portion: i.qty, food: null, mult: 1, adj: 1, unsure, renamed: false, base: { kcal: num(i.kcal), protein_g: num(i.protein_g), carbs_g: num(i.carbs_g), fat_g: num(i.fat_g) } };
  });
}

/** The macros shown for a row: its base times servings times the adjuster (prototype `phMacros`). */
export function rowMacros(r: PhotoRow): Macros {
  const k = r.mult * r.adj;
  return { kcal: r.base.kcal * k, protein_g: r.base.protein_g * k, carbs_g: r.base.carbs_g * k, fat_g: r.base.fat_g * k };
}

/** The adjuster one step up or down, kept within 0.5 to 2. */
export const stepAdj = (adj: number, dir: 1 | -1): number => Math.min(PHOTO_ADJ_MAX, Math.max(PHOTO_ADJ_MIN, adj + dir * PHOTO_ADJ_STEP));

/** The row after swapping to a food from the device (prototype `photoChange`): its name, its serving label as the portion, its macros for one serving; the adjuster stays. */
export const swapFood = (r: PhotoRow, f: CatalogFood): PhotoRow => ({ ...r, name: f.name, portion: f.serving.label, food: f, mult: 1, unsure: false, base: f.per_serving });

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The "Save to my foods" entry for a row, or null when it does not qualify: an estimate, an adjusted portion or a renamed item (prototype `ph-add`). */
export function foodToSave(r: PhotoRow): Extract<CustomFoodResult, { kind: 'ok' }>['food'] | null {
  if (r.food && r.adj === 1 && !r.renamed) return null;
  const m = rowMacros(r);
  const unit = r.portion ? `${r.portion}${r.adj !== 1 ? ` ×${r1(r.adj)}` : ''}` : '1 portion';
  const res = customFood({ name: r.name, kcal: String(Math.round(m.kcal)), protein: String(r1(m.protein_g)), carbs: String(r1(m.carbs_g)), fat: String(r1(m.fat_g)), qty: '1', unit });
  return res.kind === 'ok' ? res.food : null;
}

/**
 * What logging a row writes. A food from the list logs as that food with `qty` servings (`mult` × adjuster); an estimate
 * logs once, as a custom entry named with its portion, with the adjusted numbers (as Describe it does).
 */
export function logFromRow(r: PhotoRow): CustomFoodResult | { kind: 'ok'; log: NewLog } {
  if (r.food) {
    // The name the user sees is the one logged (prototype `addMeal({ name: it.name, ... })`), with the food's per-serving macros and
    // qty to 1 decimal. A renamed item no longer is the shared food, so it keeps no link to it (the prototype links by name).
    const name = r.name.trim() || r.food.name;
    return { kind: 'ok', log: { ...logOf(r.food, r1(r.mult * r.adj)), name, foodId: name === r.food.name ? r.food.id : null } };
  }
  const m = rowMacros(r);
  const q = r.portion.trim();
  // Logged under the plain name as the prototype's `ph-add` does (no portion suffix; that is Describe it's rule), so it agrees with the saved-food path.
  const res = customFood({ name: r.name.trim(), kcal: String(Math.round(m.kcal)), protein: String(r1(m.protein_g)), carbs: String(r1(m.carbs_g)), fat: String(r1(m.fat_g)), qty: '1', unit: q });
  return res.kind === 'ok' ? { kind: 'ok', log: { ...res.log, foodId: null } } : res;
}
