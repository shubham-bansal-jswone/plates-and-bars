import { emptyCycle, type CycleData } from '@plate-and-bar/core';
import type { StoreDb } from './records';

// The cycle log is device only (#625): one JSON row under the key 'me' in `cycle_log`, a table that is not in SYNC_TABLES and
// has no outbox trigger. Nothing here may ever be queued, pushed or sent to the server or to AI.
export const CYCLE_KEY = 'me';

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The stored cycle log; off and empty when there is none or the row cannot be read (the prototype does the same). */
export async function loadCycle(db: StoreDb): Promise<CycleData> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM cycle_log WHERE key = ?', CYCLE_KEY);
  if (!row) return emptyCycle();
  try {
    const d = JSON.parse(row.data) as Partial<CycleData>;
    const len = typeof d.len === 'number' && Number.isFinite(d.len) && d.len > 0 ? d.len : 28;
    return { on: d.on === true, starts: Array.isArray(d.starts) ? d.starts.filter(isYmd) : [], len };
  } catch {
    return emptyCycle();
  }
}

export async function saveCycle(db: StoreDb, d: CycleData): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO cycle_log (key, data) VALUES (?, ?)', CYCLE_KEY, JSON.stringify(d));
}

/** "Turn off and delete": the row is removed, not blanked. */
export async function deleteCycle(db: StoreDb): Promise<void> {
  await db.runAsync('DELETE FROM cycle_log WHERE key = ?', CYCLE_KEY);
}
