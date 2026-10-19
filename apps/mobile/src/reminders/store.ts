import type { StoreDb } from '../db/records';
import { KEY_REMINDERS, getKv, setKv } from '../sync/store';
import { parsePrefs, type ReminderPrefs } from './schedule';

/** Device-only: kept on the device under device.reminders and never synced, although the contract's Settings has a reminders field. */
export async function loadReminderPrefs(db: StoreDb): Promise<ReminderPrefs> {
  return parsePrefs(await getKv(db, KEY_REMINDERS));
}

export async function saveReminderPrefs(db: StoreDb, prefs: ReminderPrefs): Promise<void> {
  await setKv(db, KEY_REMINDERS, JSON.stringify(prefs));
}
