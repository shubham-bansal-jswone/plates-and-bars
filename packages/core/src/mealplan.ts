import { addDays, daysBetween } from './dates';
import { combos, MEAL_ORDER, OLDER_MEAL_PROTEIN_G, type Meal, type MealFood, type MealIdeasInput } from './meals';

/**
 * Weekly meal plan and grocery list (spec §5): a week of meal ideas from the day's targets, a swap per
 * meal, and the raw amounts to buy for it.
 *
 * The grocery map (prototype `GROC`) is content/meal-planning.json `grocery`, passed in. The saved plan
 * is contract `Settings.meal_plan`, whose shape core owns; it keeps the prototype's `mealPlan` shape.
 */

/** A planned food and its servings (prototype `[name, q]`). */
export type PlanItem = [name: string, qty: number];

/**
 * A week's plan (contract `Settings.meal_plan`, prototype `mealPlan`): up to four ideas per meal
 * (`opts`) and, for each of the 7 days, which idea each meal uses (`k`).
 */
export interface MealPlan {
  start: string;
  opts: Partial<Record<Meal, PlanItem[][]>>;
  days: Partial<Record<Meal, { k: number }>>[];
}

/** A grocery-map entry: content/meal-planning.json `grocery` item (prototype `GROC[food]`). */
export interface GroceryEntry {
  food: string;
  items: readonly { item: string; amount: number; unit: string }[];
}

/** The day targets a plan is built from: contract `Settings` `kcal`, `protein`, `fat`, and the profile age. */
export interface PlanTargets {
  kcal: number;
  protein: number;
  fat: number;
  /** Profile age; 60 and over gets at least 25 g protein per main meal (#239). */
  age: number | null | undefined;
}

/** Days in a plan, ideas kept per meal, and ideas rotated over the week. Mirror the 7, 4 and 3 in prototype `buildPlan()`. */
export const PLAN_DAYS = 7;
export const PLAN_OPTIONS = 4;
export const PLAN_ROTATION = 3;

/**
 * A new week's plan from `start`: per meal, the day's targets times the meal and protein weights, the
 * best four `combos` for it, and days rotating over the first three. At 60 and over, breakfast, lunch
 * and dinner aim for at least 25 g protein when the day's protein is 25 g or more, as `nextMealInfo`
 * does (#239). No fasting pool, as in the prototype. Mirrors prototype `buildPlan()`.
 */
export function buildPlan<T extends MealFood>(targets: PlanTargets, start: string, input: MealIdeasInput<T>): MealPlan {
  const W = input.planning.meal_weights;
  const PW = input.planning.protein_weights;
  const opts: Partial<Record<Meal, PlanItem[][]>> = {};
  const older = targets.age != null && targets.age >= 60;
  for (const m of MEAL_ORDER) {
    const floor = older && m !== 'Snacks' && targets.protein >= OLDER_MEAL_PROTEIN_G ? OLDER_MEAL_PROTEIN_G : 0;
    const info = { meal: m, kcal: targets.kcal * W[m], protein_g: Math.max(floor, targets.protein * PW[m]), fat_g: targets.fat * W[m] };
    opts[m] = combos(info, input)
      .slice(0, PLAN_OPTIONS)
      .map((c) => c.items.map((i): PlanItem => [i.food.name, i.qty]));
  }
  const days = Array.from({ length: PLAN_DAYS }, (_, i) => {
    const d: Partial<Record<Meal, { k: number }>> = {};
    for (const m of MEAL_ORDER) d[m] = { k: i % Math.min(PLAN_ROTATION, opts[m]?.length || 1) };
    return d;
  });
  return { start, opts, days };
}

/** The items planned for day `i`'s meal; empty when there are none. Mirrors prototype `planItems(P, i, m)`. */
export function planItems(plan: MealPlan, i: number, meal: Meal): PlanItem[] {
  const d = plan.days[i]?.[meal];
  if (!d) return [];
  return (plan.opts[meal] || [])[d.k] || [];
}

/** The plan with day `i`'s meal moved to its next idea, wrapping. Mirrors `case 'mp-swap'` of the prototype's food actions. */
export function swapPlanMeal(plan: MealPlan, i: number, meal: Meal): MealPlan {
  const d = plan.days[i]?.[meal];
  if (!d) return plan;
  const k = (d.k + 1) % Math.max(1, plan.opts[meal]?.length ?? 0);
  return { ...plan, days: plan.days.map((day, j) => (j === i ? { ...day, [meal]: { k } } : day)) };
}

/** True while a saved plan is the one to show, i.e. it started less than 7 days before `today`. Mirrors the check in prototype `planSheet()`. */
export function planIsCurrent(plan: MealPlan | null | undefined, today: string): boolean {
  return !!plan && plan.start > addDays(today, -PLAN_DAYS);
}

/** The saved plan's items for `meal` on `date`, or null outside the plan's week. Mirrors prototype `planForMeal(meal)` (date passed in). */
export function planForMeal(plan: MealPlan | null | undefined, date: string, meal: Meal): PlanItem[] | null {
  if (!plan) return null;
  const i = daysBetween(plan.start, date);
  if (i < 0 || i > 6) return null;
  return planItems(plan, i, meal);
}

/**
 * Day `i`'s planned calories and protein, unrounded (show with `Math.round`). Foods are found by name,
 * ignoring case, first match first: pass the user's foods, then the shared ones, as prototype
 * `allFoods()` orders them; unknown names count 0. Mirrors the "About … kcal" line of prototype `planSheet()`.
 */
export function planDayTotals(plan: MealPlan, i: number, foods: readonly MealFood[]): { kcal: number; protein_g: number } {
  let kcal = 0;
  let protein_g = 0;
  const day = plan.days[i] ?? {};
  for (const m of Object.keys(day) as Meal[]) {
    for (const [n, q] of planItems(plan, i, m)) {
      const name = String(n || '').toLowerCase();
      const f = foods.find((x) => x.name.toLowerCase() === name);
      if (f) {
        kcal += f.per_serving.kcal * q;
        protein_g += f.per_serving.protein_g * q;
      }
    }
  }
  return { kcal, protein_g };
}

/** One grocery line: summed raw amount and its label. */
export interface GroceryRow {
  item: string;
  unit: string;
  amount: number;
  label: string;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** A grocery amount as shown: g and ml to the nearest 10, or kg and L to 0.1 from 1000; other units rounded up. Mirrors `fmtAmt` in prototype `grocerySheet()`. */
export function groceryAmount(v: number, unit: string): string {
  if (unit === 'g') return v >= 1000 ? `${r1(v / 1000)} kg` : `${Math.round(v / 10) * 10} g`;
  if (unit === 'ml') return v >= 1000 ? `${r1(v / 1000)} L` : `${Math.round(v / 10) * 10} ml`;
  return `${Math.ceil(v)} ${unit}`;
}

/**
 * The week's grocery list: every planned food's raw items times its servings, summed per item and
 * unit. `rows` are sorted by item then unit, as the sheet shows them, and `text` (the "Copy as text"
 * lines) lists them in the same order (#240). Foods without a grocery entry add nothing. Mirrors prototype `grocerySheet()`.
 */
export function groceryList(plan: MealPlan, grocery: readonly GroceryEntry[]): { rows: GroceryRow[]; text: string } {
  const map = new Map<string, GroceryEntry>();
  for (const g of grocery) if (!map.has(g.food)) map.set(g.food, g);
  const tot = new Map<string, { item: string; unit: string; amount: number }>();
  plan.days.forEach((d, i) =>
    (Object.keys(d) as Meal[]).forEach((m) =>
      planItems(plan, i, m).forEach(([n, q]) =>
        (map.get(n)?.items ?? []).forEach(({ item, amount, unit }) => {
          const k = item + '|' + unit;
          const t = tot.get(k);
          if (t) t.amount += amount * q;
          else tot.set(k, { item, unit, amount: amount * q });
        }),
      ),
    ),
  );
  const row = (t: { item: string; unit: string; amount: number }): GroceryRow => ({ ...t, label: groceryAmount(t.amount, t.unit) });
  const sorted = [...tot.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const rows = sorted.map(([, t]) => row(t));
  const text = sorted.map(([, t]) => `${t.item}: ${groceryAmount(t.amount, t.unit)}`).join('\n');
  return { rows, text };
}
