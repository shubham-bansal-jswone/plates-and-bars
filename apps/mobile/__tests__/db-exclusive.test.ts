import { exclusive } from '../src/db/exclusive';
import { writeLock } from '../src/db/writeLock';
import type { StoreDb } from '../src/db/records';

describe('exclusive (shared by the cycle log and the lab reports)', () => {
  it('uses the database transaction when it has one', async () => {
    const txn = {} as StoreDb;
    const db = { withExclusiveTransactionAsync: jest.fn(async (task: (t: StoreDb) => Promise<void>) => task(txn)) } as unknown as StoreDb;
    const seen: StoreDb[] = [];
    await exclusive(db, async (d) => void seen.push(d));
    expect(seen).toEqual([txn]);
  });

  it('otherwise runs the task under the write lock', async () => {
    const db = {} as StoreDb;
    const spy = jest.spyOn(writeLock, 'run');
    await exclusive(db, async () => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
