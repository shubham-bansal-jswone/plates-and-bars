import type { UserFoodFields } from '@plate-and-bar/core';
import type { SyncMeta } from '../setup/types';

// Contract records (packages/api/openapi.yaml), snake_case. FoodLog and UserFood have random ids made on the
// device. DayNote is a natural-key table: its contract id is a UUIDv5 that needs the user's namespace, so `id` is null on a row made on the device.
// buildRecord sets it at push time for the signed-in user (UUIDv5 of `day_notes:<date>`, sync/records.ts); a pulled row keeps the server id (storeRecord).

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
  id: string | null;
  date: string;
  complete: boolean | null;
  steps: number | null;
  /** Where `steps` came from; absent on records from before contract 0.1.7 (with steps, that means manual). */
  steps_source?: 'manual' | 'device' | null;
  sleep: number | null;
  fast: boolean;
}

/** Contract `UserFood`. */
export interface UserFood extends SyncMeta, UserFoodFields {}
