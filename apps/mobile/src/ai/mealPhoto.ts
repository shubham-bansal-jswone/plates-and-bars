import { capPhotoItems, clampPhotoServings, customFood, num, photoAdjLabel, photoEstimateLog, photoLogQty, type CustomFoodResult, type PhotoMacros } from '@plate-and-bar/core';
import type { Schemas } from '@plate-and-bar/api';
import type { CatalogFood } from '../food/catalog';
import { logOf, type NewLog } from '../food/useFoodDay';

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
  base: PhotoMacros;
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
  return capPhotoItems(items).map((i, key) => {
    const food = i.match ? byName.get(i.match.toLowerCase()) ?? null : null;
    const unsure = i.confidence === 'low';
    if (food) return { key, name: food.name, portion: i.qty || food.serving.label, food, mult: clampPhotoServings(i.servings), adj: 1, unsure, renamed: false, base: food.per_serving };
    return { key, name: i.name || 'Item', portion: i.qty, food: null, mult: 1, adj: 1, unsure, renamed: false, base: { kcal: num(i.kcal), protein_g: num(i.protein_g), carbs_g: num(i.carbs_g), fat_g: num(i.fat_g) } };
  });
}

/** The row after swapping to a food from the device (prototype `photoChange`): its name, its serving label as the portion, its macros for one serving; the adjuster stays. */
export const swapFood = (r: PhotoRow, f: CatalogFood): PhotoRow => ({ ...r, name: f.name, portion: f.serving.label, food: f, mult: 1, unsure: false, base: f.per_serving });

/** The "Save to my foods" entry for a row, or null when it does not qualify: an estimate, an adjusted portion or a renamed item (prototype `ph-add`). */
export function foodToSave(r: PhotoRow): Extract<CustomFoodResult, { kind: 'ok' }>['food'] | null {
  if (r.food && r.adj === 1 && !r.renamed) return null;
  const m = photoEstimateLog(r.base, r.mult, r.adj);
  const unit = r.portion ? `${r.portion}${r.adj !== 1 ? ` ×${photoAdjLabel(r.adj)}` : ''}` : '1 portion';
  const res = customFood({ name: r.name, kcal: String(m.kcal), protein: String(m.protein_g), carbs: String(m.carbs_g), fat: String(m.fat_g), qty: '1', unit });
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
    return { kind: 'ok', log: { ...logOf(r.food, photoLogQty(r.mult, r.adj)), name, foodId: name === r.food.name ? r.food.id : null } };
  }
  const m = photoEstimateLog(r.base, r.mult, r.adj);
  const q = r.portion.trim();
  // Logged under the plain name as the prototype's `ph-add` does (no portion suffix; that is Describe it's rule), so it agrees with the saved-food path.
  const res = customFood({ name: r.name.trim(), kcal: String(m.kcal), protein: String(m.protein_g), carbs: String(m.carbs_g), fat: String(m.fat_g), qty: '1', unit: q });
  return res.kind === 'ok' ? { kind: 'ok', log: { ...res.log, foodId: null } } : res;
}
