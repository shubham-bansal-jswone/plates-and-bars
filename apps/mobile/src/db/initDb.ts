import type { SQLiteDatabase } from 'expo-sqlite';
import { loadContent } from '../content/loader';
import { prepareStore } from '../secure/keystore';
import { attachInstallId, reportKeystoreResetFailed } from '../telemetry/errors';
import { MIGRATIONS, migrate } from './migrations';

/**
 * SQLiteProvider's onInit. Error tracking is already running (started at module load, with no user, so errors before
 * this point are reported). The store is prepared first (migrations and, on a reinstall, the keystore clear); only then
 * is the install id attached, because it is read from the keystore. If the clear failed every attempt, the id stays off
 * this launch (it might be a stale one) and the failure is reported.
 */
export async function initDb(db: SQLiteDatabase): Promise<void> {
  const prepared = await prepareStore(db, { migrate: () => migrate(db) });
  if (prepared.reset === 'failed') reportKeystoreResetFailed();
  else await attachInstallId();
  if (prepared.version > MIGRATIONS.length) {
    console.warn(`Local database schema v${prepared.version} is newer than this app (v${MIGRATIONS.length}).`);
  }
  await loadContent(db); // never throws; the bundled copies stay in use on any failure
}
