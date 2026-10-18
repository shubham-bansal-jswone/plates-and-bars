import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { StoreDb } from '../db/records';
import { getKv, setKv } from '../sync/store';

/** Every key the app keeps in the keystore. Keep in step with tokens.ts, photos/vault.ts and telemetry/errors.ts. */
export const SECURE_KEYS = ['pb.access_token', 'pb.refresh_token', 'pb.photo_key', 'pb.install_id'] as const;
export const PHOTO_KEY = 'pb.photo_key';

/**
 * Options for the keystore writes that hold the tokens and the photo key. On iOS the item is readable only while the
 * phone is unlocked and never leaves this device, so a restored backup on another phone cannot decrypt the photos or
 * reuse the session. Android has no such option: nothing is passed there and behaviour is unchanged.
 */
export const secureOptions = (): SecureStore.SecureStoreOptions =>
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } : {};

/**
 * The iOS keychain survives an uninstall while the app's own files (the database, the photos) do not, so a reinstall
 * would come back with an old session and an old install id. The database file is the sentinel: it is wiped with the app.
 */
export const KEY_KEYSTORE_CHECKED = 'device.keystore_checked';

/** True when the database file has never been migrated: a first launch after an install or reinstall. Call before `migrate`. */
export async function storeIsNew(db: StoreDb): Promise<boolean> {
  return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"))?.n === 0;
}

export async function clearAllKeys(): Promise<void> {
  for (const k of SECURE_KEYS) await SecureStore.deleteItemAsync(k);
}

/**
 * Clears the keystore on the first launch of a new install. `fresh` (from `storeIsNew`, read before the migration) is
 * the only trigger: an install that already has a database (every Android user updating to this version) just gets the
 * sentinel and keeps its session and photo key. A `clearing` mark, written before the keys are deleted, makes a failed
 * clear run again on the next launch. Resolves to whether the keys were cleared.
 */
export async function resetKeystoreIfReinstalled(db: StoreDb, fresh: boolean, clear: () => Promise<void> = clearAllKeys): Promise<boolean> {
  const state = await getKv(db, KEY_KEYSTORE_CHECKED);
  if (state === 'done') return false;
  if (!fresh && state !== 'clearing') {
    await setKv(db, KEY_KEYSTORE_CHECKED, 'done');
    return false;
  }
  await setKv(db, KEY_KEYSTORE_CHECKED, 'clearing');
  await clear();
  await setKv(db, KEY_KEYSTORE_CHECKED, 'done');
  return true;
}
