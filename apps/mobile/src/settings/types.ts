import type { SyncMeta } from '../setup/types';

/**
 * Contract `Settings`, snake_case as in packages/api/openapi.yaml. Shapes that the contract leaves to
 * packages/core (`adjustments`, `adaptive`, `learn`, `meal_plan`, `prep`) stay open objects here.
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
  exercise_overrides: Record<string, { type: string; step_kg: number; rep_low: number; rep_high: number }>;
  flex: { date: string; kcal_delta: number }[];
  returning: Record<string, { until: string }>;
  ladder_stay: Record<string, string>;
  checkin_seen: string | null;
  adjustments: Record<string, unknown>;
  adaptive: Record<string, unknown>;
  learn: Record<string, unknown>;
  meal_plan: Record<string, unknown> | null;
  prep: Record<string, unknown>[];
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
    // The prototype's default glass and bottle sizes (renderTargets).
    water_sizes: { glass_ml: 250, bottle_ml: 1000 },
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
