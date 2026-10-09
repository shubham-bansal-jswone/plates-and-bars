import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import { SetupScreen } from '../src/screens/SetupScreen';
import { Stores } from '../src/sync/Stores';
import { SyncProvider, useSync, type SyncState } from '../src/sync/SyncProvider';
import { KEY_SERVER_DELETED, KEY_USER, getUserId, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => true }) }));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const API = 'http://fake/api/v1';
const consentRow = JSON.stringify({ id: 'c1', version: 1, updated_at: '2026-10-01T00:00:00.000Z', deleted_at: null, kind: 'data_storage', given_at: '2026-10-01T00:00:00.000Z', text_version: '1' });

const seen: { state: SyncState | null } = { state: null };
const now = (): SyncState => seen.state as SyncState;
let fetchImpl: (r: Request) => Promise<Response>;
function Probe() {
  const state = useSync();
  useEffect(() => {
    seen.state = state;
  });
  return null;
}

async function mount(opts: { bound?: boolean; tokens?: boolean; marker?: boolean; withSetup?: boolean } = {}) {
  const db = await openDb();
  const server = fakeServer(USER);
  fetchImpl = server.fetch;
  (globalThis as { fetch: unknown }).fetch = (r: Request) => fetchImpl(r); // the client keeps the fetch it was created with
  if (opts.bound) await setKv(db, KEY_USER, USER);
  if (opts.marker) await setKv(db, KEY_SERVER_DELETED, USER);
  await db.runAsync('INSERT INTO consents (key, data) VALUES (?, ?)', 'c1', consentRow);
  const tokens = memoryTokens(opts.tokens ? { access: 'access-1', refresh: 'refresh-1' } : null);
  const api = createClient(API, async () => (await tokens.load())?.access ?? null);
  await render(
    <SyncProvider db={db} tokens={tokens} api={api}>
      <Stores db={db}>
        <Probe />
        {opts.withSetup ? <SetupScreen /> : null}
      </Stores>
    </SyncProvider>,
  );
  return { db, server, tokens };
}

describe('SyncProvider account wiring (#27)', () => {
  it('linked comes from the stored user id on load, with or without tokens', async () => {
    await mount({ bound: true });
    await waitFor(() => expect(now().linked).toBe(true));
    expect(now().signedIn).toBe(false);
  });

  it('an unbound store is not linked', async () => {
    await mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(now().linked).toBe(false);
  });

  it('linked turns true on sign-in', async () => {
    await mount();
    await waitFor(() => expect(now().configured).toBe(true));
    await act(async () => {
      expect((await now().verifyCode('a@example.com', '123456')).kind).toBe('signed_in');
    });
    expect(now().linked).toBe(true);
    expect(now().signedIn).toBe(true);
  });

  it('delete everything (device only) clears linked and signed-in, records what was deleted, and the setup screen says so once', async () => {
    const { db } = await mount({ bound: true, withSetup: true });
    await waitFor(() => expect(now().linked).toBe(true));
    await act(async () => {
      expect(await now().deleteEverything({ deviceOnly: true })).toEqual({ kind: 'deleted', server: false });
    });
    expect(now().linked).toBe(false);
    expect(now().lastDeletion).toEqual({ server: false });
    expect(await getUserId(db)).toBeNull();
    expect(await screen.findByText('This device was cleared. Your account still exists.')).toBeTruthy();
  });

  it('a signed-in delete says everything was deleted', async () => {
    const { tokens } = await mount({ bound: true, tokens: true, withSetup: true });
    await waitFor(() => expect(now().signedIn).toBe(true));
    fetchImpl = async () => new Response(null, { status: 204 });
    await act(async () => {
      expect(await now().deleteEverything()).toEqual({ kind: 'deleted', server: true });
    });
    expect(tokens.current).toBeNull();
    expect(now().signedIn).toBe(false);
    expect(await screen.findByText(/Everything deleted/)).toBeTruthy();
  });

  it('discard and sign out clears linked', async () => {
    await mount({ bound: true, tokens: true });
    await waitFor(() => expect(now().linked).toBe(true));
    await act(async () => now().discardAndSignOut());
    expect(now().linked).toBe(false);
    expect(now().signedIn).toBe(false);
  });

  it('signing out with discard clears linked; signing out without it keeps the link', async () => {
    await mount({ bound: true, tokens: true });
    await waitFor(() => expect(now().linked).toBe(true));
    await act(async () => void (await now().signOut()));
    expect(now().linked).toBe(true);
    await act(async () => void (await now().signOut({ discard: true })));
    expect(now().linked).toBe(false);
  });

  it('on launch with a pending device wipe (account already deleted), the wipe is finished without a server call and reported', async () => {
    const { db, server } = await mount({ bound: true, marker: true, withSetup: true });
    expect(await screen.findByText(/Everything deleted/)).toBeTruthy();
    expect(await getUserId(db)).toBeNull();
    expect(server.calls).toHaveLength(0);
    expect(now().wipePending).toBe(false);
  });

  it('a delete whose device wipe fails sets wipePending (the account is already gone)', async () => {
    const { db, tokens } = await mount({ bound: true, tokens: true });
    await waitFor(() => expect(now().signedIn).toBe(true));
    fetchImpl = async () => new Response(null, { status: 204 });
    await db.execAsync('ALTER TABLE food_logs RENAME TO food_logs_x');
    await act(async () => {
      expect((await now().deleteEverything()).kind).toBe('local_failed');
    });
    expect(now().wipePending).toBe(true);
    expect(now().signedIn).toBe(false);
    expect(tokens.current).toBeNull();
  });

  it('on launch with a pending wipe that fails again, wipePending stays set so the screen can offer finishing', async () => {
    const db = await openDb();
    await db.execAsync('ALTER TABLE food_logs RENAME TO food_logs_x');
    await setKv(db, KEY_USER, USER);
    await setKv(db, KEY_SERVER_DELETED, USER);
    const tokens = memoryTokens();
    fetchImpl = async () => new Response(null, { status: 204 });
    (globalThis as { fetch: unknown }).fetch = (r: Request) => fetchImpl(r);
    const api = createClient(API, async () => null);
    await render(
      <SyncProvider db={db} tokens={tokens} api={api}>
        <Probe />
      </SyncProvider>,
    );
    await waitFor(() => expect(now().wipePending).toBe(true));
    expect(await getUserId(db)).toBe(USER);
  });

  it('on launch the pending wipe is flagged at once, before the wipe finishes (so the screen never offers sign-in meanwhile)', async () => {
    const db = await openDb();
    await setKv(db, KEY_USER, USER);
    await setKv(db, KEY_SERVER_DELETED, USER);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    db.beforeTxn = () => held; // the wipe's transaction waits
    const tokens = memoryTokens();
    (globalThis as { fetch: unknown }).fetch = async () => new Response(null, { status: 204 });
    const api = createClient(API, async () => null);
    await render(
      <SyncProvider db={db} tokens={tokens} api={api}>
        <Probe />
      </SyncProvider>,
    );
    await waitFor(() => expect(now().wipePending).toBe(true));
    expect(await getUserId(db)).toBe(USER); // still not wiped
    await act(async () => release());
    await waitFor(() => expect(now().wipePending).toBe(false));
  });
});
