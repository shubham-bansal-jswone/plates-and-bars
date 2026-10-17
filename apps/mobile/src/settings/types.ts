import { DEFAULT_WATER_SIZES, type ExType, type FlexEntry, type MealPlan } from '@plate-and-bar/core';
import type { SyncMeta } from '../setup/types';

/**
 * Contract `Settings`, snake_case as in packages/api/openapi.yaml. Shapes that the contract leaves to
 * packages/core (`adjustments`, `adaptive`, `learn`) stay open objects here; `prep` is read by core's prep rules.
 */
export interface Settings extends Omit<SyncMeta, 'id'> {
  /**
   * Null locally. Settings is a natural-key table (one per user): its contract id is the UUIDv5 of
   * `settings:me`, computed once the store is bound to a signed-in user (#31) or at push time.
   * TODO(#31): fill in `id` then; no device namespace is invented here (see /sync "Record ids").
   */
  id: null;
  /** Focus muscles (contract `Muscle` names). */
  focus: string[];
  /** Rest timer turned off. */
  rest_off: boolean;
  custom_tags: Record<string, unknown>;
  diet: 'any' | 'egg' | 'veg';
  water_sizes: { glass_ml: number; bottle_ml: number };
  exercise_overrides: Record<string, { type: ExType; step_kg: number; rep_low: number; rep_high: number }>;
  flex: FlexEntry[];
  returning: Record<string, { until: string }>;
  ladder_stay: Record<string, string>;
  checkin_seen: string | null;
  adjustments: Record<string, unknown>;
  adaptive: Record<string, unknown>;
  learn: Record<string, unknown>;
  /** Core's `MealPlan`: the shape the contract leaves to packages/core. */
  meal_plan: MealPlan | null;
  /** Meal-prep batches. Items are open objects in the contract: core's prep rules read the `PrepEntry` ones and keep the rest. */
  prep: unknown[];
}

/** A fresh Settings record: every required contract field present, nothing chosen yet. */
export function defaultSettings(updatedAt: string): Settings {
  return {
    id: null,
    version: 0,
    updated_at: updatedAt,
    deleted_at: null,
    focus: [],
    rest_off: false,
    custom_tags: {},
    diet: 'any',
    water_sizes: { ...DEFAULT_WATER_SIZES },
    exercise_overrides: {},
    flex: [],
    returning: {},
    ladder_stay: {},
    checkin_seen: null,
    adjustments: {},
    adaptive: {},
    learn: {},
    meal_plan: null,
    prep: [],
  };
}
