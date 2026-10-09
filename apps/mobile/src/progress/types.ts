import type { SyncMeta } from '../setup/types';

// Contract records (packages/api/openapi.yaml). Weight and Measurement are natural-key tables (one per day): their
// contract id is a UUIDv5 that needs the user's namespace, so `id` stays null locally (see food/types.ts, #31).

/** Contract `Weight`: body weight on a day. */
export interface Weight extends Omit<SyncMeta, 'id'> {
  id: null;
  date: string;
  weight_kg: number;
}

/** Contract `Measurement`: tape measurements on a day, in cm; null when not measured. */
export interface Measurement extends Omit<SyncMeta, 'id'> {
  id: null;
  date: string;
  waist_cm: number | null;
  neck_cm: number | null;
  chest_cm: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
  hips_cm: number | null;
}
