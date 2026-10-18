/** @jest-environment node */
import { ACCESS_KEY, INSTALL_ID_KEY, REFRESH_KEY } from '../src/secure/tokens';
import { PHOTO_KEY, secureOptions } from '../src/secure/keys';
import { KEY_KEYSTORE_CHECKED, SECURE_KEYS, clearAllKeys, prepareStore, resetKeystoreIfReinstalled, storeIsNew } from '../src/secure/keystore';
import { getKv, setKv } from '../src/sync/store';
import { MIGRATIONS, migrate } from '../src/db/migrations';
import { openDb } from './sync-helpers';

const mockPlatform = { OS: 'ios' };
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform?.OS ?? 'ios'; } } }));
const mockStore = new Map<string, string>();
const mockFail = new Set<string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  deleteItemAsync: async (k: string) => {
    if (mockFail.has(k)) throw new Error('keychain');
    mockStore.delete(k);
  },
}));

type Raw = { exec(s: string): void; prepare(s: string): { get(...p: unknown[]): unknown; run(...p: unknown[]): unknown } };
/** A database file that was just created: no table at all, as after an install or reinstall. */
function newFile() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => Raw };
  const raw = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (s: string) => void raw.exec(s),
    getFirstAsync: async <T,>(sql: string, ...p: (string | number)[]) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    runAsync: async (sql: string, ...p: (string | number)[]) => raw.prepare(sql).run(...p),
  };
  return { raw, db };
}
const fill = () => SECURE_KEYS.forEach((k) => mockStore.set(k, 'old'));

beforeEach(() => {
  mockStore.clear();
  mockFail.clear();
  mockPlatform.OS = 'ios';
});

describe('keystore keys', () => {
  it('lists every key the app stores, from the constants of the modules that write them', () => {
    expect([...SECURE_KEYS]).toEqual([ACCESS_KEY, REFRESH_KEY, PHOTO_KEY, INSTALL_ID_KEY]);
  });

  it('clearAllKeys tries every key even when one fails, and then rejects', async () => {
    fill();
    mockFail.add(REFRESH_KEY);
    await expect(clearAllKeys()).rejects.toThrow();
    expect([...mockStore.keys()]).toEqual([REFRESH_KEY]);
  });

  it('options: iOS this device only; Android nothing passed', () => {
    expect(secureOptions()).toEqual({ keychainAccessible: 6 });
    mockPlatform.OS = 'android';
    expect(secureOptions()).toEqual({});
  });
});

describe('storeIsNew', () => {
  it('a database file that was never migrated is new; a migrated one is not', async () => {
    const { db, raw } = newFile();
    expect(await storeIsNew(db)).toBe(true);
    raw.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL)');
    expect(await storeIsNew(db)).toBe(false);
    expect(await storeIsNew(await openDb())).toBe(false);
  });
});

describe('resetKeystoreIfReinstalled', () => {
  it('a new install: clears all four keys and records it', async () => {
    const db = await openDb();
    fill();
    expect(await resetKeystoreIfReinstalled(db, true)).toBe('cleared');
    expect(mockStore.size).toBe(0);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('an existing install with no sentinel yet (the update): nothing is cleared, the sentinel is written', async () => {
    const db = await openDb();
    fill();
    expect(await resetKeystoreIfReinstalled(db, false)).toBe('skipped');
    expect(mockStore.size).toBe(SECURE_KEYS.length);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('later launches never clear, even if the database looks new', async () => {
    const db = await openDb();
    await setKv(db, KEY_KEYSTORE_CHECKED, 'done');
    fill();
    expect(await resetKeystoreIfReinstalled(db, true)).toBe('skipped');
    expect(mockStore.size).toBe(SECURE_KEYS.length);
  });

  it('a clear that fails is retried within the launch, then succeeds', async () => {
    const db = await openDb();
    let calls = 0;
    const clear = async () => {
      if (++calls < 3) throw new Error('keychain');
    };
    expect(await resetKeystoreIfReinstalled(db, true, clear)).toBe('cleared');
    expect(calls).toBe(3);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('after the attempts it reports failed and marks done: the next launch does not clear (the user may have signed in since)', async () => {
    const db = await openDb();
    let calls = 0;
    const clear = async () => {
      calls++;
      throw new Error('keychain');
    };
    expect(await resetKeystoreIfReinstalled(db, true, clear)).toBe('failed');
    expect(calls).toBe(3);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
    expect(await resetKeystoreIfReinstalled(db, true, clear)).toBe('skipped');
    expect(calls).toBe(3);
  });
});

describe('prepareStore', () => {
  it('a new file: reads "new" before the migration, migrates, then clears the keys and writes the sentinel', async () => {
    const { db } = newFile();
    const log: string[] = [];
    fill();
    const out = await prepareStore(db, {
      migrate: async () => {
        log.push(`migrate (store was new: ${await storeIsNew(db)})`);
        const v = await migrate(db);
        return v;
      },
      clear: async () => {
        log.push(`clear (migrated: ${(await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'settings'"))?.n === 1})`);
        mockStore.clear();
      },
    });
    expect(log).toEqual(['migrate (store was new: true)', 'clear (migrated: true)']);
    expect(out).toEqual({ version: MIGRATIONS.length, reset: 'cleared' });
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('a store that was already migrated is not new: the keys stay and only the sentinel is written', async () => {
    const { db } = newFile();
    await migrate(db);
    const clear = jest.fn(async () => undefined);
    expect(await prepareStore(db, { migrate: () => migrate(db), clear })).toEqual({ version: MIGRATIONS.length, reset: 'skipped' });
    expect(clear).not.toHaveBeenCalled();
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('web: only migrates, never touches the keystore or the sentinel', async () => {
    mockPlatform.OS = 'web';
    const { db } = newFile();
    const clear = jest.fn(async () => undefined);
    expect(await prepareStore(db, { migrate: () => migrate(db), clear })).toEqual({ version: MIGRATIONS.length, reset: 'skipped' });
    expect(clear).not.toHaveBeenCalled();
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBeNull();
  });
});
