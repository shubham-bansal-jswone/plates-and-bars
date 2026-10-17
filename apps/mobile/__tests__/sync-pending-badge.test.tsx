import { act, render, waitFor } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import { lockedDb } from '../src/db/lockedDb';
import { SyncProvider, useSync } from '../src/sync/SyncProvider';
import { KEY_USER, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';
import { saveWeightDoc } from './sync-fixtures';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('the pending count after a local write (#767)', () => {
  /** A mounted provider over a fresh db; `latest()` reads its current value. */
  async function mount() {
    const db = await openDb();
    const server = fakeServer(USER);
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    server.accessValid = 'access-1';
    const api = createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null);
    let latest!: ReturnType<typeof useSync>;
    const Grab = () => {
      latest = useSync();
      return null;
    };
    await render(
      <SyncProvider db={db} tokens={tokens} api={api}>
        <Grab />
      </SyncProvider>,
    );
    await waitFor(() => expect(latest.last?.status).toBe('ok'));
    return { db: lockedDb(db as never) as unknown as typeof db, latest: () => latest };
  }
  const weight = { id: null, version: 0, updated_at: '2026-10-09T06:00:00.000Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 };

  it('rises as soon as a store writes, without waiting for the next sync tick', async () => {
    const { db, latest } = await mount();
    expect(latest().pending).toBe(0);
    await act(async () => saveWeightDoc(db, weight));
    await waitFor(() => expect(latest().pending).toBe(1)); // well before the 30 s tick
  });

  // The listener runs only once the write has committed, so a rejected statement and a rolled-back transaction both
  // leave the count at 0: "Not synced" must never appear for a write that did not happen.
  it('does not rise when the statement throws', async () => {
    const { db, latest } = await mount();
    await act(async () => {
      await expect(db.runAsync('insert into no_such_table (x) values (1)')).rejects.toThrow();
    });
    expect(latest().pending).toBe(0);
  });

  it('does not rise when a transaction writes and then throws (it rolls back)', async () => {
    const { db, latest } = await mount();
    await act(async () => {
      await expect(
        db.withExclusiveTransactionAsync(async (txn) => {
          await saveWeightDoc(txn as never, weight);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
    });
    expect(latest().pending).toBe(0);
  });
});
