import { inTransaction, type PullDb } from './outbox';
import type { StoreDb } from './records';
import { writeLock } from './writeLock';

/** One read-then-write under the write lock the store wipe takes, in a transaction where the database has them (it always does outside tests). */
export const exclusive = (db: StoreDb, task: (d: StoreDb) => Promise<void>): Promise<void> =>
  typeof (db as Partial<PullDb>).withExclusiveTransactionAsync === 'function' ? inTransaction(db as StoreDb & PullDb, task) : writeLock.run(() => task(db));
