import type { SQLiteDatabase } from 'expo-sqlite';
import { loadContent } from '../content/loader';
import { prepareStore } from '../secure/keystore';
import { initErrorTracking, reportKeystoreResetFailed } from '../telemetry/errors';
import { MIGRATIONS, migrate } from './migrations';

/**
 * SQLiteProvider's onInit. The store is prepared first (migrations and, on a reinstall, the keystore clear); only then is
 * error tracking started, because it reads the install id from the keystore. Errors raised before that are not tracked.
 * If the store could not be prepared, tracking still starts, without the stored install id (it might be a stale one).
 */
export async function initDb(db: SQLiteDatabase): Promise<void> {
  let prepared;
  try {
    prepared = await prepareStore(db, { migrate: () => migrate(db) });
  } catch (e) {
    initErrorTracking(undefined, undefined, { withoutInstallId: true }); // no-op unless EXPO_PUBLIC_SENTRY_DSN is set
    throw e;
  }
  const failed = prepared.reset === 'failed';
  initErrorTracking(undefined, undefined, { withoutInstallId: failed });
  if (failed) reportKeystoreResetFailed();
  if (prepared.version > MIGRATIONS.length) {
    console.warn(`Local database schema v${prepared.version} is newer than this app (v${MIGRATIONS.length}).`);
  }
  await loadContent(db); // never throws; the bundled copies stay in use on any failure
}
