import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncDb } from './engine';

/**
 * The app's database as the sync code needs it. expo-sqlite has no exclusive transactions on web (it throws), so there a
 * plain transaction on the one connection is used; native keeps the exclusive one.
 */
export function syncDb(db: SQLiteDatabase): SyncDb {
  if (Platform.OS !== 'web') return db;
  return Object.assign(Object.create(db) as SQLiteDatabase, {
    withExclusiveTransactionAsync: (task: (txn: SQLiteDatabase) => Promise<void>) => db.withTransactionAsync(() => task(db)),
  });
}
