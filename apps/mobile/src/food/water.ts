import type { SyncMeta } from '../setup/types';

/** Contract `WaterLog`: one drink. */
export interface WaterLog extends SyncMeta {
  date: string;
  ml: number;
}

/** Litres as the card prints them (prototype `L`): one decimal, en-IN grouping. */
export const litres = (ml: number): string => (Math.round(ml / 100) / 10).toLocaleString('en-IN');
