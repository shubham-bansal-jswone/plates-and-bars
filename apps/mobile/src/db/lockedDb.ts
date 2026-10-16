import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useMemo } from 'react';
import type { SyncDb } from '../sync/engine';
import { syncDb } from '../sync/db';
import { writeLock } from './writeLock';

/**
 * The database with every statement taking the app write lock, so a store's write waits for a running sync transaction
 * instead of running inside it (web, one connection) or failing with "database is locked" (native).
 */
export function lockedDb(db: SQLiteDatabase): SQLiteDatabase {
  const locked = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => (...a: A) => writeLock.run(() => f.apply(db, a));
  return Object.assign(Object.create(db) as SQLiteDatabase, {
    runAsync: locked(db.runAsync),
    execAsync: locked(db.execAsync),
    getFirstAsync: locked(db.getFirstAsync),
    getAllAsync: locked(db.getAllAsync),
    // From the raw db, not the locked one: `inTransaction` already holds the lock, and on web BEGIN would wait for it. Web has no
    // exclusive transactions, so syncDb gives it a plain one.
    withExclusiveTransactionAsync: (task: Parameters<SyncDb['withExclusiveTransactionAsync']>[0]) => syncDb(db).withExclusiveTransactionAsync(task),
  });
}

/** The app's database for stores and screens: `useSQLiteContext()` behind the write lock. */
export function useDb(): SQLiteDatabase {
  const db = useSQLiteContext();
  return useMemo(() => lockedDb(db), [db]);
}
