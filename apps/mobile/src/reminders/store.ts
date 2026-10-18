import type { StoreDb } from '../db/records';
import { KEY_REMINDERS, getKv, setKv } from '../sync/store';
import { parsePrefs, type ReminderPrefs } from './schedule';

/** Device-only: the contract's Settings has no reminder fields, so nothing here syncs. */
export async function loadReminderPrefs(db: StoreDb): Promise<ReminderPrefs> {
  return parsePrefs(await getKv(db, KEY_REMINDERS));
}

export async function saveReminderPrefs(db: StoreDb, prefs: ReminderPrefs): Promise<void> {
  await setKv(db, KEY_REMINDERS, JSON.stringify(prefs));
}
