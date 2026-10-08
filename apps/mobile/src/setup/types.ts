import type { Activity, Experience, Goal, Pace, ScreenAnswer, Sex, Special, Where } from '@plate-and-bar/core';

/** Fields every synced record carries (contract `SyncMeta`). */
export interface SyncMeta {
  id: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

/** Contract `Targets`. */
export interface StoredTargets {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Contract `Profile`, snake_case as in packages/api/openapi.yaml. */
export interface Profile extends Omit<SyncMeta, 'id'> {
  /**
   * Null locally. Profile is a natural-key table (one per user): its contract id is the UUIDv5 of
   * `profiles:me`, computed once the store is bound to a signed-in user (#31) or at push time.
   * TODO(#31): fill in `id` then; no device namespace is invented here (see /sync "Record ids").
   */
  id: null;
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;
  activity: Activity;
  where: Where;
  days: number;
  exp: Experience | null;
  minutes: number | null;
  goal: Goal;
  pace: Pace;
  special: Special;
  screen: ScreenAnswer[];
  created: string;
  cleared: string | null;
  targets: StoredTargets;
}

/** Contract `Consent`. */
export interface Consent extends SyncMeta {
  kind: 'data_storage';
  given_at: string;
  text_version: string;
}
