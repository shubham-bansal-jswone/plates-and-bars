import { customFood, num, type CustomFoodResult } from '@plate-and-bar/core';
import type { Schemas } from '@plate-and-bar/api';
import type { CatalogFood } from '../food/catalog';
import { logOf, type NewLog } from '../food/useFoodDay';

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
    if (food) return { key, name: food.name, portion: i.qty || food.serving.label, food, mult: Math.min(PHOTO_SERVINGS_MAX, Math.max(PHOTO_SERVINGS_MIN, num(i.servings) || 1)), adj: 1, unsure, base: food.per_serving };
    return { key, name: i.name || 'Item', portion: i.qty, food: null, mult: 1, adj: 1, unsure, base: { kcal: num(i.kcal), protein_g: num(i.protein_g), carbs_g: num(i.carbs_g), fat_g: num(i.fat_g) } };
  });
}

/** The macros shown for a row: its base times servings times the adjuster (prototype `phMacros`). */
export function rowMacros(r: PhotoRow): Macros {
  const k = r.mult * r.adj;
  return { kcal: r.base.kcal * k, protein_g: r.base.protein_g * k, carbs_g: r.base.carbs_g * k, fat_g: r.base.fat_g * k };
}

/** The adjuster one step up or down, kept within 0.5 to 2. */
export const stepAdj = (adj: number, dir: 1 | -1): number => Math.min(PHOTO_ADJ_MAX, Math.max(PHOTO_ADJ_MIN, adj + dir * PHOTO_ADJ_STEP));

/** The row after swapping to a food from the device: that food's macros for one serving, adjuster kept. */
export const swapFood = (r: PhotoRow, f: CatalogFood): PhotoRow => ({ ...r, name: f.name, food: f, mult: 1, unsure: false, base: f.per_serving });

/**
 * What logging a row writes. A food from the list logs as that food with `qty` servings (`mult` × adjuster); an estimate
 * logs once, as a custom entry named with its portion, with the adjusted numbers (as Describe it does).
 */
export function logFromRow(r: PhotoRow): CustomFoodResult | { kind: 'ok'; log: NewLog } {
  if (r.food) return { kind: 'ok', log: logOf(r.food, Math.round(r.mult * r.adj * 100) / 100) };
  const m = rowMacros(r);
  const q = r.portion.trim();
  const res = customFood({ name: q ? `${r.name.trim()} (${q})` : r.name, kcal: String(Math.round(m.kcal)), protein: String(Math.round(m.protein_g * 10) / 10), carbs: String(Math.round(m.carbs_g * 10) / 10), fat: String(Math.round(m.fat_g * 10) / 10), qty: '1', unit: q });
  return res.kind === 'ok' ? { kind: 'ok', log: { ...res.log, foodId: null } } : res;
}
