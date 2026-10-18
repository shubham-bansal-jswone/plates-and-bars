import { advanceSteps, type StepBaseline, type StepReading } from '@plate-and-bar/core';
import { loadDayNote, patchDayNote } from '../db/food';
import type { StoreDb } from '../db/records';

// Device-local keys in the key/value `settings` table (never synced): the toggle, and the last reading with the day count so far.
const KEY_ON = 'steps.device.on';
const KEY_BASELINE = 'steps.device.baseline';

export async function loadStepsOn(db: StoreDb): Promise<boolean> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY_ON))?.value === '1';
}

/** Turning on or off both start counting afresh: the old baseline is dropped. */
export async function saveStepsOn(db: StoreDb, on: boolean): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_BASELINE);
  if (on) await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY_ON, '1');
  else await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_ON);
}

const isBaseline = (b: unknown): b is StepBaseline => {
  const x = b as Partial<StepBaseline> | null;
  return !!x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && [x.steps, x.counter, x.elapsedMs].every((n) => typeof n === 'number' && Number.isFinite(n));
};

/** The stored baseline; a missing or damaged one reads as none (counting starts again at 0). */
async function loadBaseline(db: StoreDb): Promise<StepBaseline | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY_BASELINE);
  if (!row) return null;
  try {
    const b: unknown = JSON.parse(row.value);
    return isBaseline(b) ? b : null;
  } catch {
    return null;
  }
}

/**
 * Takes one reading and writes the day totals it adds (core's `advanceSteps`) onto the day notes with `steps_source: 'device'`.
 * A day with steps typed in is left alone (typed always wins), and a day's device count never goes down. Returns true when a note
 * changed. Call it from the write queue; `read` returns null when there is no reading, and nothing is written then.
 */
export async function syncDeviceSteps(db: StoreDb, read: () => Promise<StepReading | null>, today: string, stamp: string): Promise<boolean> {
  const reading = await read();
  if (!reading) return false;
  const { baseline, credits } = advanceSteps(await loadBaseline(db), reading, today);
  // Baseline first: a failed note write then loses at most this reading's steps, and cannot count them twice.
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY_BASELINE, JSON.stringify(baseline));
  let changed = false;
  for (const { date, steps } of credits) {
    const note = await loadDayNote(db, date);
    if (note && !note.deleted_at && note.steps !== null && (note.steps_source !== 'device' || note.steps >= steps)) continue;
    await patchDayNote(db, date, { steps, steps_source: 'device' }, stamp);
    changed = true;
  }
  return changed;
}
