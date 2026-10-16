/* eslint-disable @typescript-eslint/no-require-imports -- modules are loaded per test so the vault sees Platform.OS = web */
import type { SQLiteDatabase } from 'expo-sqlite';
import { openDb } from './sync-helpers';

jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

type Vault = typeof import('../src/photos/vault');
type Guard = typeof import('../src/sync/guard');
type Store = typeof import('../src/sync/store');

/** The photo wipe (#251) on web: the vault is in memory, and the store is the one connection that has no exclusive transactions. */
describe('owed photo wipe on web (#517)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A real SQLite that behaves like expo-sqlite on web, behind lockedDb; `leaked` is set when a statement takes the write lock while a transaction is open. */
  async function webDb() {
    let lockedDb!: typeof import('../src/db/lockedDb').lockedDb, writeLock!: typeof import('../src/db/writeLock').writeLock;
    let vault!: Vault, guard!: Guard, store!: Store;
    jest.isolateModules(() => {
      // The vault and syncDb read Platform.OS, so this registry gets a react-native that says web.
      jest.doMock('react-native', () => {
        const rn = jest.requireActual('react-native');
        return Object.create(rn, { Platform: { value: Object.create(rn.Platform, { OS: { value: 'web' } }) } });
      });
      lockedDb = require('../src/db/lockedDb').lockedDb;
      writeLock = require('../src/db/writeLock').writeLock;
      vault = require('../src/photos/vault');
      guard = require('../src/sync/guard');
      store = require('../src/sync/store');
    });
    const sqlite = await openDb();
    let open = false;
    const raw = Object.assign(sqlite, {
      withExclusiveTransactionAsync: async () => {
        throw new Error('withExclusiveTransactionAsync is not supported on web');
      },
      withTransactionAsync: async (task: () => Promise<void>) => {
        open = true;
        await sqlite.execAsync('BEGIN');
        try {
          await task();
          await sqlite.execAsync('COMMIT');
        } catch (e) {
          await sqlite.execAsync('ROLLBACK');
          throw e;
        } finally {
          open = false;
        }
      },
    });
    const state = { leaked: false };
    const run = writeLock.run.bind(writeLock);
    jest.spyOn(writeLock, 'run').mockImplementation((task) => {
      if (open) state.leaked = true; // on a device this waits for the open transaction, which waits for this: a deadlock
      return run(task);
    });
    return { db: lockedDb(raw as unknown as SQLiteDatabase) as unknown as Parameters<Guard['completePhotoWipe']>[0], vault, guard, store, state };
  }

  it('a store wipe sets the marker, wipes the in-memory vault and clears the marker, with nothing in the transaction through the locked db', async () => {
    const { db, vault, guard, store, state } = await webDb();
    expect(vault.persistent).toBe(false);
    await vault.putPhoto('2026-10-01', 'front', 'AAAA');
    const told: boolean[] = [];
    vault.onPhotosWiped((ok) => told.push(ok));

    expect(await guard.wipeLocalStore(db, { force: true })).toBe(0);

    expect(state.leaked).toBe(false);
    expect(await vault.photoDates()).toEqual([]);
    expect(await vault.getPhoto('2026-10-01', 'front')).toBeNull();
    expect(await store.getKv(db, store.KEY_PHOTOS_WIPE)).toBeNull();
    expect(told).toEqual([true]);
  });

  it('an owed wipe left by an earlier run is finished by completePhotoWipe', async () => {
    const { db, vault, guard, store, state } = await webDb();
    await vault.putPhoto('2026-10-01', 'side', 'BBBB');
    await store.setKv(db, store.KEY_PHOTOS_WIPE, '1');

    await guard.completePhotoWipe(db);

    expect(state.leaked).toBe(false);
    expect(await vault.getPhoto('2026-10-01', 'side')).toBeNull();
    expect(await store.getKv(db, store.KEY_PHOTOS_WIPE)).toBeNull();
  });
});
