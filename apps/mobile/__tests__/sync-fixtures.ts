import type { StoreDb } from '../src/db/records';

export interface WeightDoc {
  id: string | null;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  date: string;
  weight_kg: number;
}

/** Test stand-in for the writer of the weights table (no app code writes it yet). */
export async function saveWeightDoc(db: StoreDb, w: WeightDoc): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO weights (key, data) VALUES (?, ?)', w.date, JSON.stringify(w));
}
