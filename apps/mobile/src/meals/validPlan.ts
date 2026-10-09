import type { MealPlan } from '@plate-and-bar/core';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stored `meal_plan` when it has core's `MealPlan` shape, else null: a malformed record (a sync pull, an old build) is ignored instead of crashing the screens that read it. */
export function validMealPlan(v: unknown): MealPlan | null {
  if (!isObj(v) || typeof v.start !== 'string' || !isObj(v.opts) || !Array.isArray(v.days)) return null;
  const itemOk = (i: unknown): boolean => Array.isArray(i) && typeof i[0] === 'string' && typeof i[1] === 'number';
  const optsOk = Object.values(v.opts).every((m) => Array.isArray(m) && m.every((idea) => Array.isArray(idea) && idea.every(itemOk)));
  const daysOk = v.days.every((d) => isObj(d) && Object.values(d).every((x) => isObj(x) && typeof x.k === 'number'));
  return optsOk && daysOk ? (v as unknown as MealPlan) : null;
}
