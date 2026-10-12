import type { GroceryEntry, MealPlanningContent } from '@plate-and-bar/core';
import planning from '../../../../content/meal-planning.json';
import { contentReader, isArrOf, isNumIn, isObj, isText, perLoad } from '../content/reader';
import { chosenFoods } from '../food/catalog';

const NAME_MAX = 200;
const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const;
/** Role and diet codes core reads (`MealRole`). */
const ROLES: readonly string[] = ['p', 'c', 'v', 'b', 'bp', 'sp', 's', 'f', 'side'];
const DIETS: readonly string[] = ['v', 'e', 'n'];
// Shipped maxima: weights 0.35, portions 4, grocery amount 150. Generous headroom above those.
const WEIGHT = isNumIn(0, 1);
const PORTION_MAX = 50;
const AMOUNT_MAX = 10000;

interface Planning extends MealPlanningContent { grocery: GroceryEntry[] }
const shipped = planning as unknown as Planning;

const isWeights = (v: unknown): boolean => isObj(v) && MEALS.every((m) => WEIGHT(v[m]));
const isPortions = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every((n) => isNumIn(0, PORTION_MAX)(n) && n > 0);
const isRole = (v: unknown): boolean => isObj(v) && isText(NAME_MAX)(v.food) && ROLES.includes(v.role as string) && DIETS.includes(v.diet as string);
const isGroceryItem = (v: unknown): boolean => isObj(v) && isText(NAME_MAX)(v.item) && isNumIn(0, AMOUNT_MAX)(v.amount) && v.amount > 0 && isText(20)(v.unit);
const isGrocery = (v: unknown): boolean => isObj(v) && isText(NAME_MAX)(v.food) && isArrOf(v.items, isGroceryItem as (x: unknown) => x is never) && (v.items as unknown[]).length > 0;

/** The food names each section names, kept apart: a name must stay in every section that has it (a role is not a grocery entry). */
const sections = (p: Planning): string[][] => [p.roles.map((r) => r.food), p.grocery.map((g) => g.food), Object.keys(p.max_portions), Object.keys(p.min_portions)];
const shippedSections = sections(shipped);

/**
 * A stored meal-planning copy must be valid in every key and keep every food name the shipped copy has (core looks roles,
 * caps and the grocery map up by name, and the fixed MAIN_CARBS, SIDE_SETS and FAST_PROTEINS lists rely on them). It must
 * also name only foods that exist in the foods bundle chosen at app start: a plan that mentions a food the catalog lacks
 * rejects the whole planning copy (the shipped one is used), so the two bundles can never disagree.
 */
const isPlanning = (v: unknown): v is Planning => {
  if (!isObj(v) || !isWeights(v.meal_weights) || !isWeights(v.protein_weights) || !isPortions(v.max_portions) || !isPortions(v.min_portions)) return false;
  if (!isArrOf(v.roles, isRole as (x: unknown) => x is never) || v.roles.length === 0 || !isArrOf(v.grocery, isGrocery as (x: unknown) => x is never) || v.grocery.length === 0) return false;
  const max = v.max_portions as Record<string, number>;
  const min = v.min_portions as Record<string, number>;
  if (Object.keys(min).some((k) => k in max && min[k]! > max[k]!)) return false;
  const p = v as unknown as Planning;
  const have = sections(p);
  if (!shippedSections.every((names, i) => names.every((n) => have[i]!.includes(n)))) return false;
  const catalog = new Set(chosenFoods().foods.map((f) => f.name));
  return have.every((names) => names.every((n) => catalog.has(n)));
};

/** The single accept or reject decision for the meal-planning bundle: the plan, the ideas card and the grocery list all read it. */
export const chosenPlanning = contentReader('meal-planning', shipped, isPlanning);

/** content/meal-planning.json: meal and protein weights, portion caps and food roles. Call it where it is used, not at module level. */
export const getMealPlanning: () => MealPlanningContent = perLoad(() => chosenPlanning());

/** content/meal-planning.json `grocery`: the raw amounts bought per serving of a food. */
export const getMealGrocery: () => GroceryEntry[] = perLoad(() => chosenPlanning().grocery);
