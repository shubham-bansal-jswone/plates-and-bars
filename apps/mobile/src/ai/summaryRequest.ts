import type { Goal, WeeklyCheckin } from '@plate-and-bar/core';
import type { Schemas } from '@plate-and-bar/api';
import { catalog } from '../workout/catalog';

/** The fixed label the contract asks for in place of any exercise that is not in the catalogue (never a user-typed name). */
export const CUSTOM_EXERCISE = 'custom exercise';
const exerciseId = (name: string): string => (Object.prototype.hasOwnProperty.call(catalog.tags, name) ? name : CUSTOM_EXERCISE);
const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);

/**
 * `WeeklySummaryRequest` from core's weekly check-in and the targets. Only the contract's fields are copied, so nothing
 * else (names, logs, dates) can leak into the request. Null when the week has no planned session (the contract needs 1+).
 */
export function buildSummaryRequest(k: WeeklyCheckin, targets: { kcal: number; protein_g: number }, goal: Goal | null): Schemas['WeeklySummaryRequest'] | null {
  if (k.plannedN < 1) return null;
  return {
    sessions: k.sessions,
    planned_sessions: k.plannedN,
    logged_days: k.logged,
    avg_kcal: k.avgK,
    avg_protein_g: k.avgP,
    protein_days: k.pDays,
    weight_avg_kg: positive(k.w1),
    prev_weight_avg_kg: positive(k.w0),
    improved: k.improved.map((x) => ({ exercise: exerciseId(x.n), pct: x.pct })),
    stalled: k.stalled.map(exerciseId),
    burn_kcal: k.burn.ready ? Math.round(k.burn.burn) : null,
    target_kcal: targets.kcal,
    target_protein_g: targets.protein_g,
    goal,
  };
}
