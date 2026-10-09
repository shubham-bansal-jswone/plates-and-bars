/**
 * One app-level async lock for every database write that must not interleave: sync transactions, and (through
 * `lockedDb`) the stores' own writes. expo-sqlite on web has one connection, so a query issued while a transaction is open
 * runs inside it; on native `withExclusiveTransactionAsync` uses a second connection and other writes fail with
 * "database is locked". Waiting here avoids both.
 */
export class WriteLock {
  private tail: Promise<unknown> = Promise.resolve();

  /** Runs `task` after every earlier task has finished (whether it succeeded or failed). */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export const writeLock = new WriteLock();
