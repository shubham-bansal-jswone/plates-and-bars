import { addDays } from './dates';
import type { Meal } from './meals';
import { MEAL_ORDER } from './meals';
import type { PerKatori } from './recipes';

/**
 * Meal prep: a batch cooked once and eaten over the week, a katori at a time (spec: meal prep). The entries are
 * contract `Settings.prep` (the contract leaves the shape to this package): the prototype's `S.settings.prep`
 * entries with the food's macros in the contract's `_g` names.
 */
export interface PrepEntry {
  id: string;
  name: string;
  meal: Meal;
  /** Portions (katoris) still to eat. */
  left: number;
  /** Last day (inclusive) the batch is offered: the day it was made plus `PREP_DAYS`. */
  until: string;
  /** One katori's values (energy rounded, macros to 0.1). */
  food: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
}

/** A batch keeps this many days after the day it was made. Mirrors the 6 in prototype `case 'rb-prep'`. */
export const PREP_DAYS = 6;
/** Contract limit on `Settings.prep` (`maxItems`); the prototype does not cap it. */
export const PREP_MAX = 100;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether a stored `Settings.prep` item is a prep entry this package wrote. Other items (from another client or a newer app) are never shown, logged or changed, but are kept in the list. */
export function isPrepEntry(v: unknown): v is PrepEntry {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.until !== 'string' || !fin(v.left)) return false;
  if (typeof v.meal !== 'string' || !(MEAL_ORDER as readonly string[]).includes(v.meal)) return false;
  const f = v.food;
  return isObj(f) && fin(f.kcal) && fin(f.protein_g) && fin(f.carbs_g) && fin(f.fat_g);
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const live = (p: PrepEntry, date: string): boolean => p.left > 0 && p.until >= date;

export interface AddPrepInput {
  id: string;
  name: string;
  meal: Meal;
  /** Katoris the batch made (core's `recipeTotals().katoris`). */
  katoris: number;
  /** One katori's values, unrounded (core's `recipeTotals().perKatori`). */
  perKatori: PerKatori;
  today: string;
}

/**
 * The prep list after "Save as meal prep": batches used up or past their last day are dropped, then the new one is added
 * with a portion per katori made (rounded, at least 1) kept until `PREP_DAYS` days from today. Call it only once the
 * recipe itself saved (`recipeFood` returned ok). Items this build does not recognise are kept; the newest `PREP_MAX` of all are kept.
 *
 * Mirrors the prep step of prototype `case 'rb-prep'`.
 */
export function addPrep(prep: readonly unknown[], input: AddPrepInput): unknown[] {
  // Deliberate difference: an item this build does not recognise is kept as it is, although the prototype's `rb-prep` prune (`left > 0 && until >= today`)
  // would drop it (an unreadable item fails that test). Dropping another client's data on a local add would lose it; only batches known to be over go.
  const kept = prep.filter((p) => !isPrepEntry(p) || live(p, input.today));
  const { perKatori: per } = input;
  const entry: PrepEntry = {
    id: input.id,
    name: input.name,
    meal: input.meal,
    left: Math.max(1, Math.round(input.katoris)),
    until: addDays(input.today, PREP_DAYS),
    food: { kcal: Math.round(per.kcal), protein_g: r1(per.protein_g), carbs_g: r1(per.carbs_g), fat_g: r1(per.fat_g) },
  };
  return [...kept, entry].slice(-PREP_MAX);
}

/** The batches to offer under `meal` on `date`: portions left and not past their last day. Mirrors prototype `prepLineHtml(meal)`. */
export function prepFor(prep: readonly unknown[], meal: Meal, date: string): PrepEntry[] {
  return prep.filter(isPrepEntry).filter((p) => p.meal === meal && live(p, date));
}

/**
 * "Log 1 katori": the entry to log (one portion of the batch's food) and the list with one fewer portion left.
 * Null when the batch is gone or has nothing left (a second tap). Mirrors prototype `case 'prep-log'`.
 */
export function logPrep(prep: readonly unknown[], id: string): { entry: PrepEntry; prep: unknown[] } | null {
  const entry = prep.filter(isPrepEntry).find((p) => p.id === id);
  if (!entry || entry.left <= 0) return null;
  return { entry, prep: prep.map((p) => (p === entry ? { ...entry, left: entry.left - 1 } : p)) };
}
