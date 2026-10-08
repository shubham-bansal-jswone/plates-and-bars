import { num } from './num';

/**
 * Food maths for the food screen (PROTOTYPE_SPEC section 5). Foods come in content/foods.json's `Food`
 * shape (per-serving values, `serving.grams`, `aliases`, `fruit_veg_servings`); logs in the contract's
 * `FoodLog` shape. Each type below lists only the fields read, so a `Food` or `FoodLog` passes as is.
 */

/** What `searchFoods` reads: `name` and `aliases` (prototype `f[0]` and `ALIAS[f[0]]`). */
export interface SearchableFood {
  name: string;
  /** Other names; matched as one space-joined string, as prototype `ALIAS` stores them. User foods have none. */
  aliases?: readonly string[] | undefined;
}

/** What `quantityFromGrams` reads: contract `Serving.grams` (prototype `unitGrams(f)`; null for 0). */
export interface GramsFood {
  serving: { grams: number | null };
}

/**
 * What the fibre, added-sugar and fruit and veg lookups read, matched to a log by exact `name` (as
 * prototype `fibOf` and `produceOf` do). A content `Food` passes as is; for a user food (contract
 * `UserFood`) pass `{ name, per_serving: { fibre_g, added_sugar_g }, fruit_veg_servings }`.
 */
export interface FoodFacts {
  name: string;
  per_serving: { fibre_g: number | null; added_sugar_g: number | null };
  fruit_veg_servings: number | null;
}

/** What the totals read from a log (contract `FoodLog`; values are per serving, `qty` servings). */
export interface FoodLogFacts {
  name: string;
  qty: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** A tombstone: logs with a non-null value are left out (the prototype deletes the meal). */
  deleted_at?: string | null | undefined;
}

/** Day totals, unrounded as in the prototype. Show energy, fibre and sugar with `Math.round` (prototype `fmt`). */
export interface DayTotals {
  kcal: number;
  protein_g: number;
  /** Total carbohydrate including fibre. */
  carbs_g: number;
  fat_g: number;
  /** From logs whose food has fibre data only. */
  fibre_g: number;
  /** From logs whose food has fibre data only. */
  added_sugar_g: number;
  /** Logs without fibre data (photo estimates, custom foods): the "N items … aren’t counted" hint. */
  withoutFibre: number;
}

/** What `dayComplete` reads from the day (contract `DayNote.complete`; null or no note: never ticked). */
export interface CompleteFlag {
  complete?: boolean | null | undefined;
}

/** Result of `quantityFromGrams`. */
export type GramsQuantity =
  /** No grams entered (0, empty or not a number): log the chosen servings. */
  | { kind: 'servings' }
  /** Grams entered and the serving has a gram weight: log `qty` servings (grams / serving grams, to 0.1). */
  | { kind: 'grams'; qty: number }
  /** Grams entered but the serving has no gram weight: log nothing ("… is measured in …, not grams. Use servings."). */
  | { kind: 'not-in-grams' };

/** Fruit and veg servings goal shown as "of 5 servings" (prototype `fibreHtml`). */
export const FRUIT_VEG_TARGET = 5;

const live = <T extends { deleted_at?: string | null | undefined }>(logs: readonly T[]): T[] => logs.filter((l) => !l.deleted_at);

/**
 * Foods matching a search, in list order (the prototype does not rank). The query is trimmed and
 * lower-cased; a food matches when its lower-cased name contains it, or its aliases joined with spaces
 * contain it (so a query may span two aliases, and aliases are not lower-cased). An empty query matches all.
 * Pass the user's foods first, then the shared foods, as prototype `allFoods()` lists them.
 *
 * Mirrors prototype `foodListHtml()`'s query and filter with `foodMatch(f, q)`.
 */
export function searchFoods<T extends SearchableFood>(query: string, foods: readonly T[]): T[] {
  const q = query.trim().toLowerCase();
  return foods.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.aliases ?? []).join(' ').includes(q));
}

/**
 * Grams in a serving label: the first whole number followed by "g" (e.g. "1 katori (35 g dal)" → 35),
 * else 0. Content foods carry this as `serving.grams` (null for 0); use this for user foods' `unit`.
 *
 * Mirrors prototype `unitGrams(f)` (label passed in).
 */
export function unitGrams(label: string): number {
  const m = String(label).match(/(\d+)\s*g\b/);
  return m ? +(m[1] as string) : 0;
}

/**
 * Servings to log for grams typed in the food list's grams box. `grams` is the raw input, parsed with
 * `num` (comma decimals accepted). For bracketed weights the grams are the dry or ingredient weight (#97).
 * The quantity is rounded to 0.1 and can be 0 for tiny amounts, as in the prototype.
 *
 * Mirrors the `ug`, `g`, `qty` and "not grams" steps of prototype `case 'pick'`.
 */
export function quantityFromGrams(food: GramsFood, grams: number | string): GramsQuantity {
  const ug = food.serving.grams ?? 0;
  const g = num(grams);
  if (!(g > 0)) return { kind: 'servings' };
  if (!ug) return { kind: 'not-in-grams' };
  return { kind: 'grams', qty: Math.round((g / ug) * 10) / 10 };
}

/** The first food named `name` with fibre data, as prototype `fibOf` (shared `FIB`, then the user's foods). */
function fibreOf(name: string, foods: readonly FoodFacts[]): FoodFacts | undefined {
  return foods.find((f) => f.name === name && f.per_serving.fibre_g !== null);
}

/**
 * Day totals of the logs: energy and macros from each log's own per-serving values × `qty`, fibre and
 * added sugar from the food of the same name. Pass the shared foods, then the user's foods (names are
 * unique within each), so a shared food wins, as prototype `FIB` is read before `myFoods`.
 *
 * Mirrors prototype `totals(meals)` plus the `fib`, `sug` and `unknown` parts of `fibreTotals(meals)`.
 */
export function logTotals(logs: readonly FoodLogFacts[], foods: readonly FoodFacts[]): DayTotals {
  const t: DayTotals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, added_sugar_g: 0, withoutFibre: 0 };
  for (const m of live(logs)) {
    t.kcal += m.kcal * m.qty;
    t.protein_g += m.protein_g * m.qty;
    t.carbs_g += m.carbs_g * m.qty;
    t.fat_g += m.fat_g * m.qty;
    const f = fibreOf(m.name, foods);
    if (f) {
      t.fibre_g += (f.per_serving.fibre_g as number) * m.qty;
      t.added_sugar_g += (f.per_serving.added_sugar_g ?? 0) * m.qty;
    } else t.withoutFibre++;
  }
  return t;
}

/**
 * Daily fibre target in grams: 15 g per 1,000 kcal, rounded, at least 25 g. Pass today's calorie
 * target (prototype `kcalTarget(S.date)`, flex days included).
 *
 * Mirrors prototype `fibreTarget()`.
 */
export function fibreTarget(kcalTarget: number): number {
  return Math.max(25, Math.round((kcalTarget * 15) / 1000));
}

/**
 * Fruit and veg servings eaten (out of `FRUIT_VEG_TARGET`), unrounded; show with one decimal (prototype
 * `r1`). Each log counts the first nonzero `fruit_veg_servings` of a food with its name × `qty`. Pass
 * the shared foods, then the user's foods, as for `logTotals`.
 *
 * Mirrors the `veg` part of prototype `fibreTotals(meals)` with `produceOf(m)`.
 */
export function fruitVegServings(logs: readonly FoodLogFacts[], foods: readonly FoodFacts[]): number {
  let veg = 0;
  for (const m of live(logs)) veg += (foods.find((f) => f.name === m.name && f.fruit_veg_servings)?.fruit_veg_servings ?? 0) * m.qty;
  return veg;
}

/**
 * Whether the food screen shows the added-sugar figure: at 10 g or more (unrounded).
 *
 * Mirrors the `t.sug >= 10` check in prototype `fibreHtml()`.
 */
export function showAddedSugar(totals: Pick<DayTotals, 'added_sugar_g'>): boolean {
  return totals.added_sugar_g >= 10;
}

/**
 * Whether a day counts as complete for the real-burn estimate. The user's tick decides when set
 * (true or false); otherwise the day needs 3 or more logged items (not meal slots) and energy of at
 * least 75% of `kcalTarget`, the settings target (prototype `S.settings.kcal`, not the flexed target).
 * The prototype applies this fallback to every day, today included. `logs` are that day's logs.
 *
 * Mirrors prototype `dayComplete(d)`.
 */
export function dayComplete(day: CompleteFlag | null | undefined, logs: readonly FoodLogFacts[], kcalTarget: number): boolean {
  if (day?.complete) return true;
  if (day?.complete === false) return false;
  const meals = live(logs);
  let kcal = 0;
  for (const m of meals) kcal += m.kcal * m.qty;
  return meals.length >= 3 && kcal >= kcalTarget * 0.75;
}
