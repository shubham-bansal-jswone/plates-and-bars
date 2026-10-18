import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { StoreDb } from '../db/records';
import { getKv, setKv } from '../sync/store';
import { PHOTO_KEY } from './keys';
import { ACCESS_KEY, INSTALL_ID_KEY, REFRESH_KEY } from './tokens';

/** Every key the app keeps in the keystore. */
export const SECURE_KEYS = [ACCESS_KEY, REFRESH_KEY, PHOTO_KEY, INSTALL_ID_KEY] as const;

/**
 * The iOS keychain survives an uninstall while the app's own files (the database, the photos) do not, so a reinstall
 * would come back with an old session and an old install id. The database file is the sentinel: it is wiped with the app.
 */
export const KEY_KEYSTORE_CHECKED = 'device.keystore_checked';
export const CLEAR_ATTEMPTS = 3;

/** True when the database file has never been migrated: a first launch after an install or reinstall. Call before `migrate`. */
export async function storeIsNew(db: StoreDb): Promise<boolean> {
  return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"))?.n === 0;
}

/** Tries every key even if one fails; rejects if any did. */
export async function clearAllKeys(): Promise<void> {
  const results = await Promise.allSettled(SECURE_KEYS.map((k) => SecureStore.deleteItemAsync(k)));
  if (results.some((r) => r.status === 'rejected')) throw new Error('keystore clear failed');
}

export type ResetResult = 'cleared' | 'failed' | 'skipped';

/**
 * Clears the keystore on the first launch of a new install, and only then: `fresh` (from `storeIsNew`, read before the
 * migration) is the only trigger. An install that already has a database (every Android user updating to this version)
 * just gets the sentinel and keeps its session and photo key. The clear is tried up to `attempts` times in this launch;
 * the sentinel is then marked done either way, so a later launch never clears (by then the user may have signed in
 * again). 'failed' means the old keys may still be there: the caller reports it.
 */
export async function resetKeystoreIfReinstalled(db: StoreDb, fresh: boolean, clear: () => Promise<void> = clearAllKeys, attempts = CLEAR_ATTEMPTS): Promise<ResetResult> {
  if ((await getKv(db, KEY_KEYSTORE_CHECKED)) === 'done') return 'skipped';
  let result: ResetResult = 'skipped';
  if (fresh) {
    result = 'failed';
    for (let i = 0; i < attempts && result === 'failed'; i++) {
      try {
        await clear();
        result = 'cleared';
      } catch {
        // try again
      }
    }
  }
  await setKv(db, KEY_KEYSTORE_CHECKED, 'done');
  return result;
}

/** What `prepareStore` needs besides the database. */
export interface PrepareDeps {
  /** Runs the schema migrations and returns the schema version. */
  migrate: () => Promise<number>;
  clear?: () => Promise<void>;
  attempts?: number;
}

/**
 * Opens the store for the app, in this order: is the file new (before the migration creates its tables), migrate, then
 * on a new native install clear the old keystore and write the sentinel. Nothing may read the keystore (the install id
 * for error tracking, the tokens, the photo key) before this has finished. Web has no keystore and is not touched.
 */
export async function prepareStore(db: StoreDb, deps: PrepareDeps): Promise<{ version: number; reset: ResetResult }> {
  if (Platform.OS === 'web') return { version: await deps.migrate(), reset: 'skipped' };
  const fresh = await storeIsNew(db);
  const version = await deps.migrate();
  return { version, reset: await resetKeystoreIfReinstalled(db, fresh, deps.clear, deps.attempts) };
}
