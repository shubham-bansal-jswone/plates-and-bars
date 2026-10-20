import type { LabHold, LabReport, LabTest } from '@plate-and-bar/core';
import type { StoreDb } from './records';
import type { WorkoutDb } from './workouts';

// Lab reports and the lab hold are device only (#1070): JSON rows in `lab_store`, a table that is not in SYNC_TABLES and has no
// outbox trigger (like cycle_log). Report rows are keyed `lab|<date>|<id>` as in the prototype; the hold is the row 'hold'.
// Nothing here may ever be queued, pushed, logged or sent to the server or to AI.
export type LabDb = StoreDb & Pick<WorkoutDb, 'getAllAsync'>;

export const HOLD_KEY = 'hold';
const PREFIX = 'lab|';

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isTest = (t: unknown): t is LabTest => {
  const x = t as Partial<Record<keyof LabTest, unknown>> | null;
  return !!x && typeof x === 'object' && isStr(x.name) && isStr(x.value) && isStr(x.unit) && isStr(x.low) && isStr(x.high);
};

/** A damaged or foreign row reads as no report, never as an error. */
function parseReport(id: string, data: string): LabReport | null {
  try {
    const r = JSON.parse(data) as Partial<LabReport>;
    return isYmd(r.date) && Array.isArray(r.tests) && r.tests.every(isTest) ? { id, date: r.date, tests: r.tests } : null;
  } catch {
    return null;
  }
}

/** Every saved report, oldest first (key order is date order). */
export async function loadReports(db: LabDb): Promise<LabReport[]> {
  const rows = await db.getAllAsync<{ key: string; data: string }>('SELECT key, data FROM lab_store ORDER BY key');
  return rows
    .filter((r) => r.key.startsWith(PREFIX))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .flatMap((r) => parseReport(r.key.split('|').slice(2).join('|'), r.data) ?? []);
}

export async function saveReport(db: StoreDb, r: LabReport): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lab_store (key, data) VALUES (?, ?)', `${PREFIX}${r.date}|${r.id}`, JSON.stringify({ date: r.date, tests: r.tests }));
}

/** The stored hold; null when there is none or the row cannot be read. */
export async function loadHold(db: StoreDb): Promise<LabHold | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM lab_store WHERE key = ?', HOLD_KEY);
  if (!row) return null;
  try {
    const h = JSON.parse(row.data) as Partial<LabHold>;
    return typeof h.on === 'boolean' ? { on: h.on, ...(isYmd(h.since) ? { since: h.since } : {}) } : null;
  } catch {
    return null;
  }
}

export async function saveHold(db: StoreDb, h: LabHold): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO lab_store (key, data) VALUES (?, ?)', HOLD_KEY, JSON.stringify(h));
}

/** "Delete all reports": every `lab|` row goes, readable or not. The hold stays: only "I've seen my doctor" clears it (prototype `lab-del`). */
export async function deleteReports(db: StoreDb): Promise<void> {
  await db.runAsync("DELETE FROM lab_store WHERE key LIKE 'lab|%'");
}

// A change signal, so every screen that reads the hold (Food, Workout, Targets, Progress) reads it again at once. Same idea as storeEpoch.
let version = 0;
const listeners = new Set<() => void>();
export const labsVersion = (): number => version;
export const subscribeLabs = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** Call after the reports or the hold changed in the store (a save, a clear, a wipe). */
export function notifyLabsChanged(): void {
  version += 1;
  listeners.forEach((l) => l());
}
