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
  it('rises as soon as a store writes, without waiting for the next sync tick', async () => {
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
    expect(latest.pending).toBe(0);
    const w = { id: null, version: 0, updated_at: '2026-10-09T06:00:00.000Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 };
    await act(async () => saveWeightDoc(lockedDb(db as never) as unknown as typeof db, w));
    await waitFor(() => expect(latest.pending).toBe(1)); // well before the 30 s tick
  });
});
