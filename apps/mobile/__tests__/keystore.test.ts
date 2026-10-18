/** @jest-environment node */
import { MIGRATIONS, migrate } from '../src/db/migrations';
import { KEY_KEYSTORE_CHECKED, SECURE_KEYS, resetKeystoreIfReinstalled, secureOptions, storeIsNew } from '../src/secure/keystore';
import { getKv, setKv } from '../src/sync/store';
import { openDb } from './sync-helpers';

const mockPlatform = { OS: 'ios' };
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform.OS; } } }));
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

/** A database file that was just created: no table at all, as after an install or reinstall. */
async function newFile() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { get(...p: unknown[]): unknown; run(...p: unknown[]): unknown } } };
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    db: {
      getFirstAsync: async <T,>(sql: string, ...p: (string | number)[]) => ((raw.prepare(sql).get(...p) as T | undefined) ?? null),
      runAsync: async (sql: string, ...p: (string | number)[]) => raw.prepare(sql).run(...p),
    },
  };
}
const fill = () => SECURE_KEYS.forEach((k) => mockStore.set(k, 'old'));

describe('keystore sentinel', () => {
  beforeEach(() => {
    mockStore.clear();
    mockPlatform.OS = 'ios';
  });

  it('lists every key the app stores', () => {
    expect([...SECURE_KEYS]).toEqual(['pb.access_token', 'pb.refresh_token', 'pb.photo_key', 'pb.install_id']);
  });

  it('a database file that was never migrated is new; a migrated one is not', async () => {
    const { db, raw } = await newFile();
    expect(await storeIsNew(db)).toBe(true);
    raw.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL)');
    expect(await storeIsNew(db)).toBe(false);
    expect(await storeIsNew(await openDb())).toBe(false);
  });

  it('first launch after a reinstall (new file): clears all four keys and records it', async () => {
    const { db, raw } = await newFile();
    expect(await storeIsNew(db)).toBe(true);
    await migrate({ execAsync: async (s) => void raw.exec(s), getFirstAsync: db.getFirstAsync, runAsync: db.runAsync });
    fill();
    expect(await resetKeystoreIfReinstalled(db, true, async () => void SECURE_KEYS.forEach((k) => mockStore.delete(k)))).toBe(true);
    expect(mockStore.size).toBe(0);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('uses the real key list by default', async () => {
    const db = await openDb();
    fill();
    mockStore.set('other', 'kept');
    expect(await resetKeystoreIfReinstalled(db, true)).toBe(true);
    expect([...mockStore.keys()]).toEqual(['other']);
  });

  it('existing install with no sentinel yet (the update): nothing is cleared, the sentinel is written', async () => {
    const db = await openDb();
    fill();
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    expect(await resetKeystoreIfReinstalled(db, false)).toBe(false);
    expect(mockStore.size).toBe(SECURE_KEYS.length);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });

  it('later launches never clear, even if the database looks new', async () => {
    const db = await openDb();
    await setKv(db, KEY_KEYSTORE_CHECKED, 'done');
    fill();
    expect(await resetKeystoreIfReinstalled(db, true)).toBe(false);
    expect(mockStore.size).toBe(SECURE_KEYS.length);
  });

  it('a clear that failed is run again on the next launch, when the file is no longer new', async () => {
    const db = await openDb();
    fill();
    await expect(resetKeystoreIfReinstalled(db, true, async () => { throw new Error('keychain'); })).rejects.toThrow('keychain');
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('clearing');
    expect(await resetKeystoreIfReinstalled(db, false)).toBe(true);
    expect(mockStore.size).toBe(0);
    expect(await getKv(db, KEY_KEYSTORE_CHECKED)).toBe('done');
  });
});

describe('keystore options', () => {
  it('iOS: this device only; Android: nothing passed', () => {
    mockPlatform.OS = 'ios';
    expect(secureOptions()).toEqual({ keychainAccessible: 6 });
    mockPlatform.OS = 'android';
    expect(secureOptions()).toEqual({});
  });
});
