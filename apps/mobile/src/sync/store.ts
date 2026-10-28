import type { StoreDb } from '../db/records';

// Sync bookkeeping lives in the device-local `settings` key/value table under `sync.` keys, so wiping them is one prefix.
export const KEY_USER = 'sync.user_id';
/** Device-only (not `sync.`, so sign-out and sync wipes keep it): the account of this user id was deleted on the server and the device wipe is still to do. Removed by the forced wipe. */
export const KEY_SERVER_DELETED = 'device.server_deleted';
/** Set in the same transaction as a store wipe and cleared once the photo vault is wiped too (#251). */
export const KEY_PHOTOS_WIPE = 'device.photos_wipe_pending';
/** Settings edits whose save failed, kept across restarts (#651). Device-only, but removed by a store wipe: they belong to the account that is wiped. */
export const KEY_SETTINGS_KEPT = 'device.settings_kept';
/** Reminder choices (#943). Device-only like the settings edits kept above: removed by a store wipe, with the alarms. */
export const KEY_REMINDERS = 'device.reminders';
/** The running rest dock (#1143): end time, label and list, so a reload resumes it. Device-only, removed by a store wipe with the day it belongs to. */
export const KEY_REST = 'device.rest';
/** The weight unit shown and typed, `kg` or `lb` (#1185). Device-only, never synced, and kept by a store wipe: a display preference holds no personal data. */
export const KEY_WEIGHT_UNIT = 'device.weight_unit';
/** The plate calculator's bar weight and available plates per unit (#1176). Device-only, never synced, kept by a store wipe like the unit: gym equipment holds no personal data. */
export const KEY_PLATES = 'device.plates';
export const KEY_CURSOR = 'sync.cursor';
/** Set once the cursor was reset after the upgrade that added the routines table (ADR 011), so `routines` already on the server are pulled. */
export const KEY_ROUTINES_PULLED = 'sync.routines_pulled';
const liftKey = (exercise: string) => `sync.lift.${exercise}`;

export async function getKv(db: StoreDb, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
}
export async function setKv(db: StoreDb, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}
export const getUserId = (db: StoreDb) => getKv(db, KEY_USER);
export const getCursor = (db: StoreDb) => getKv(db, KEY_CURSOR);

/** Server version of a lift record (lift_stats rows hold core's own shape, which has no sync fields). */
export async function getLiftVersion(db: StoreDb, exercise: string): Promise<number> {
  return Number((await getKv(db, liftKey(exercise))) ?? 0);
}
export const setLiftVersion = (db: StoreDb, exercise: string, version: number) => setKv(db, liftKey(exercise), String(version));
