import type { UserFoodFields } from '@plate-and-bar/core';
import type { SyncMeta } from '../setup/types';

// Contract records (packages/api/openapi.yaml), snake_case. FoodLog and UserFood have random ids made on the
// device. DayNote is a natural-key table: its contract id is a UUIDv5 that needs the user's namespace, so `id` stays null locally.
// TODO(#31): fill in `DayNote.id` (UUIDv5 of `day_notes:<date>`) once the store is bound to a user.

/** The contract's meal slots (`FoodLog.meal`). */
export const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const;
export type Meal = (typeof MEALS)[number];

/** Contract `FoodLog`: one logged food; values are per serving, `qty` servings. */
export interface FoodLog extends SyncMeta {
  date: string;
  meal: Meal;
  name: string;
  qty: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  food_id: string | null;
}

/** Contract `DayNote`: one per day. */
export interface DayNote extends Omit<SyncMeta, 'id'> {
  id: null;
  date: string;
  complete: boolean | null;
  steps: number | null;
  sleep: number | null;
  fast: boolean;
}

/** Contract `UserFood`. */
export interface UserFood extends SyncMeta, UserFoodFields {}
