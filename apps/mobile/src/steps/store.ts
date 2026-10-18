import { advanceSteps, type StepBaseline, type StepReading } from '@plate-and-bar/core';
import { loadDayNote, patchDayNote } from '../db/food';
import { inTransaction, type PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';

// Device-local keys in the key/value `settings` table (never synced): the toggle, and the last reading with the day count so far.
// The baseline holds a day's step count, so `wipeLocalStore` deletes both keys with the rest of the previous user's data.
export const KEY_STEPS_ON = 'steps.device.on';
export const KEY_STEPS_BASELINE = 'steps.device.baseline';
const KEY_ON = KEY_STEPS_ON;
const KEY_BASELINE = KEY_STEPS_BASELINE;

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
 * changed. `read` returns null when there is no reading, and nothing is written then. The baseline and the notes are written in one
 * exclusive transaction under the app write lock, so a sleep save or a wipe cannot land between them; `stale` is checked inside it
 * (a wipe or a turn-off since the reading started: write nothing).
 */
export async function syncDeviceSteps(
  db: StoreDb & PullDb,
  read: () => Promise<StepReading | null>,
  at: { today: string; msSinceMidnight: number; stamp: string },
  stale: () => boolean = () => false,
): Promise<boolean> {
  const reading = await read();
  if (!reading) return false;
  let changed = false;
  await inTransaction(db, async (txn) => {
    if (stale()) return;
    const { baseline, credits } = advanceSteps(await loadBaseline(txn), reading, at.today, at.msSinceMidnight);
    if (baseline) await txn.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY_BASELINE, JSON.stringify(baseline));
    for (const { date, steps } of credits) {
      const note = await loadDayNote(txn, date);
      if (note && !note.deleted_at && note.steps !== null && (note.steps_source !== 'device' || note.steps >= steps)) continue;
      await patchDayNote(txn, date, { steps, steps_source: 'device' }, at.stamp);
      changed = true;
    }
  });
  return changed;
}
