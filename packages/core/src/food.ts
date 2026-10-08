import { num } from './num';
import { toTargetsProfile, type SetupProfile } from './setup';
import { calcTargets } from './targets';

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
  | { kind: 'not-in-grams' }
  /** Grams round to 0 servings: log nothing and ask for a larger amount (#150; the prototype logs qty 0). */
  | { kind: 'too-small' };

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
 * The quantity is rounded to 0.1. When that gives 0 the result is `too-small` (decided on #150; the
 * prototype logs qty 0 and follows in the next spec-change batch).
 *
 * Mirrors the `ug`, `g`, `qty` and "not grams" steps of prototype `case 'pick'`, except `too-small`.
 */
export function quantityFromGrams(food: GramsFood, grams: number | string): GramsQuantity {
  const ug = food.serving.grams ?? 0;
  const g = num(grams);
  if (!(g > 0)) return { kind: 'servings' };
  if (!ug) return { kind: 'not-in-grams' };
  const qty = Math.round((g / ug) * 10) / 10;
  return qty ? { kind: 'grams', qty } : { kind: 'too-small' };
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

/** Prototype `DEFAULT_SETTINGS.kcal`: the calorie target before setup (no profile). */
export const DEFAULT_KCAL_TARGET = 1900;

/** One calorie move between days (contract `Settings.flex` item; prototype `{ date, d }`). */
export interface FlexEntry {
  date: string;
  kcal_delta: number;
}

/** What `kcalTarget` reads from settings. */
export interface KcalTargetSettings {
  /** Contract `Settings.flex`. */
  flex?: readonly FlexEntry[] | null | undefined;
  /** Lab hold on (prototype `labHoldOn()`; not synced in v0). */
  labHold?: boolean | undefined;
}

/** What `kcalTarget` reads from the profile: the `calcTargets` answers and the saved target. */
export type KcalTargetProfile = Pick<SetupProfile, 'sex' | 'age' | 'height_cm' | 'weight_kg' | 'activity' | 'days' | 'minutes' | 'goal' | 'pace' | 'special'> & {
  targets: { kcal: number };
};

/**
 * The calorie target for `date`. Normally the saved target (`profile.targets.kcal`, or
 * `DEFAULT_KCAL_TARGET` with no profile) plus that date's flex entries. During a lab hold with a
 * profile it is the larger of the saved target and maintenance (`calcTargets` tdee, to the nearest
 * 10), and flex entries are ignored.
 *
 * Mirrors prototype `kcalTarget(date)` (settings and profile passed in).
 */
export function kcalTarget(date: string, settings: KcalTargetSettings, profile: KcalTargetProfile | null | undefined): number {
  const kcal = profile ? profile.targets.kcal : DEFAULT_KCAL_TARGET;
  if (settings.labHold && profile) return Math.max(kcal, Math.round(calcTargets(toTargetsProfile(profile)).tdee / 10) * 10);
  return kcal + (settings.flex ?? []).filter((x) => x.date === date).reduce((a, x) => a + x.kcal_delta, 0);
}

/** Servings stepper limits and step (prototype `case 'serv'`: 0.5 to 10, ± 0.5; starts at 1). */
export const SERVINGS_MIN = 0.5;
export const SERVINGS_MAX = 10;
export const SERVINGS_STEP = 0.5;

/**
 * The servings after one tap of − (`dir` −1) or + (`dir` 1), kept within 0.5 to 10. Show with one decimal.
 *
 * Mirrors prototype `case 'serv'`.
 */
export function stepServings(servings: number, dir: 1 | -1): number {
  return Math.max(SERVINGS_MIN, Math.min(SERVINGS_MAX, servings + dir * SERVINGS_STEP));
}

/**
 * The list's "high protein" badge: energy above 0 and at least 8 g protein per 100 kcal.
 *
 * Mirrors the badge check in prototype `foodListHtml()`.
 */
export function highProtein(food: { per_serving: { kcal: number; protein_g: number } }): boolean {
  return !!food.per_serving.kcal && (food.per_serving.protein_g * 100) / food.per_serving.kcal >= 8;
}

/** The custom-food form's raw inputs (strings as typed; parsed with `num`). */
export interface CustomFoodInput {
  name: string;
  kcal: string | number;
  protein: string | number;
  carbs: string | number;
  fat: string | number;
  /** Servings eaten; empty or 0 means 1. */
  qty: string | number;
  /** Serving size, e.g. "1 plate"; empty means "1 serving". */
  unit: string;
}

/** A user food in contract `UserFood` fields (without sync fields). */
export interface UserFoodFields {
  name: string;
  unit: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number | null;
  added_sugar_g: number | null;
  fruit_veg_servings: number | null;
  origin: 'custom' | 'recipe' | 'kitchen_test';
}

/** Result of `customFood`. */
export type CustomFoodResult =
  /** No name: "Give the food a name." */
  | { kind: 'no-name' }
  /** No calories and no macros: "Enter calories or at least one macro." */
  | { kind: 'no-kcal' }
  /** The log to add (contract `FoodLog` values) and the food to save if "Save to my foods" is ticked. */
  | { kind: 'ok'; log: { name: string; qty: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number }; food: UserFoodFields };

/**
 * The custom-food form. Calories, when 0 or empty, come from the macros (round(p×4 + c×4 + f×9));
 * entered calories and macros are kept unrounded. The saved food has no fibre, sugar or fruit and veg data.
 *
 * Mirrors prototype `case 'addcustom'` (checks, log and saved food).
 */
export function customFood(input: CustomFoodInput): CustomFoodResult {
  const name = input.name.trim();
  const p = num(input.protein), c = num(input.carbs), f = num(input.fat);
  let k = num(input.kcal);
  if (!k) k = Math.round(p * 4 + c * 4 + f * 9);
  if (!name) return { kind: 'no-name' };
  if (!k) return { kind: 'no-kcal' };
  const qty = num(input.qty) || 1;
  return {
    kind: 'ok',
    log: { name, qty, kcal: k, protein_g: p, carbs_g: c, fat_g: f },
    food: { name, unit: input.unit.trim() || '1 serving', kcal: k, protein_g: p, carbs_g: c, fat_g: f, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' },
  };
}

/** Most foods kept in "my foods" (prototype `.slice(0,60)`). */
export const MY_FOODS_MAX = 60;

/**
 * "My foods" after saving `food`: it goes first, any food of the same name is dropped, and only the
 * first 60 are kept. Pass the list newest first; foods missing from the result are to be deleted.
 *
 * Mirrors the save step of prototype `case 'addcustom'`.
 */
export function saveMyFood<T extends { name: string }>(myFoods: readonly T[], food: T): T[] {
  return [food, ...myFoods.filter((x) => x.name !== food.name)].slice(0, MY_FOODS_MAX);
}

/** A user food in the shape every food-maths function reads (see `userFoodFacts`). */
export interface UserFoodFacts extends SearchableFood, GramsFood, FoodFacts {
  serving: { label: string; grams: number | null };
  per_serving: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number | null; added_sugar_g: number | null };
}

/**
 * A contract `UserFood` as the food-maths inputs read it (search, grams, fibre, fruit and veg, badge):
 * no aliases, `serving.label` from `unit` ("1 serving" when empty, as prototype `allFoods()`), and
 * `serving.grams` from `unitGrams(label)` (null for 0).
 *
 * Mirrors the `myFoods` mapping in prototype `allFoods()` and the `myFoods` reads in `fibOf` and `produceOf`.
 */
export function userFoodFacts(u: Pick<UserFoodFields, 'name' | 'unit' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fibre_g' | 'added_sugar_g' | 'fruit_veg_servings'>): UserFoodFacts {
  const label = u.unit || '1 serving';
  return {
    name: u.name,
    aliases: [],
    serving: { label, grams: unitGrams(label) || null },
    per_serving: { kcal: u.kcal, protein_g: u.protein_g, carbs_g: u.carbs_g, fat_g: u.fat_g, fibre_g: u.fibre_g, added_sugar_g: u.added_sugar_g },
    fruit_veg_servings: u.fruit_veg_servings,
  };
}
