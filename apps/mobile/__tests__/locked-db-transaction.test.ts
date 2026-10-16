import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { inTransaction } from '../src/db/outbox';
import { lockedDb } from '../src/db/lockedDb';

/** A raw database like expo-sqlite's: no exclusive transactions on web, and a plain transaction issues BEGIN on itself. */
function rawDb(web: boolean) {
  const log: string[] = [];
  const raw = {
    log,
    execAsync: async (sql: string) => void log.push(sql),
    runAsync: async (sql: string) => void log.push(sql),
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    withTransactionAsync: async function (this: { execAsync(s: string): Promise<void> }, task: () => Promise<void>) {
      await this.execAsync('BEGIN');
      await task();
      await this.execAsync('COMMIT');
    },
    withExclusiveTransactionAsync: async (task: (t: unknown) => Promise<void>) => {
      if (web) throw new Error('withExclusiveTransactionAsync is not supported on web');
      log.push('exclusive');
      await task(raw);
    },
  };
  return raw;
}

describe('lockedDb transactions', () => {
  const original = Platform.OS;
  afterEach(() => void (Platform.OS = original));

  it.each(['web', 'android'] as const)('inTransaction runs the task and returns on %s (no throw, no lock deadlock)', async (os) => {
    Platform.OS = os;
    const raw = rawDb(os === 'web');
    await inTransaction(lockedDb(raw as unknown as SQLiteDatabase), async (txn) => void (await txn.runAsync('INSERT')));
    expect(raw.log).toEqual(os === 'web' ? ['BEGIN', 'INSERT', 'COMMIT'] : ['exclusive', 'INSERT']);
  });
});
