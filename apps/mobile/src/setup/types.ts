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
export interface Profile extends SyncMeta {
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
