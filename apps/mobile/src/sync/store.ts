import type { StoreDb } from '../db/records';

// Sync bookkeeping lives in the device-local `settings` key/value table under `sync.` keys, so wiping them is one prefix.
export const KEY_USER = 'sync.user_id';
export const KEY_CURSOR = 'sync.cursor';
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
