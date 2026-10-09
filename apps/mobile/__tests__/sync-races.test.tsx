import { act, render, screen, waitFor } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import { Text } from 'react-native';
import { applyPulled, pendingCount } from '../src/db/outbox';
import { lockedDb } from '../src/db/lockedDb';
import { writeLock } from '../src/db/writeLock';
import { pauseSync, resumeSync, syncOnce } from '../src/sync/engine';
import { discardAll } from '../src/sync/guard';
import { naturalId } from '../src/sync/ids';
import { Stores } from '../src/sync/Stores';
import { SyncProvider, useSync } from '../src/sync/SyncProvider';
import { useProfile } from '../src/state/ProfileProvider';
import { gateRedirect } from '../src/state/gateRedirect';
import { getCursor, getUserId, KEY_USER, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';
import { saveWeightDoc } from './sync-fixtures';
import { saveWeight } from '../src/db/progress';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_USER = ['0c9d8e7f', '6a5b', '4c3d', '8e2f', '1a0b9c8d7e6f'].join('-');
const API = 'http://fake/api/v1';
const w = (date: string, kg: number) => ({ id: null, version: 0, updated_at: '2026-10-09T06:00:00.000Z', deleted_at: null, date, weight_kg: kg });
const gate = () => {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
};

async function setup(tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' })) {
  const db = await openDb();
  const server = fakeServer(USER);
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const api = createClient(API, async () => (await tokens.load())?.access ?? null);
  return { db, server, tokens, api, deps: { db, api, tokens } };
}

describe('discarding while a sync is running', () => {
  it('waits for the run, and nothing comes back: no rows, no cursor, no binding, no tokens', async () => {
    const { db, server, tokens, deps } = await setup();
    await saveWeightDoc(db, w('2026-10-08', 80));
    server.put('weights', { id: await naturalId(USER, 'weights', '2026-10-07'), version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: '2026-10-07', weight_kg: 79 });
    const slow = gate();
    server.hold = slow.p;
    const run = syncOnce(deps); // request in flight, response held
    await new Promise((r) => setTimeout(r, 10));
    const discard = discardAll(db, tokens);
    slow.release();
    await discard;
    expect((await run).status).toBe('paused');
    expect(await db.getFirstAsync('SELECT key FROM weights')).toBeNull();
    expect(await getCursor(db)).toBeNull();
    expect(await getUserId(db)).toBeNull();
    expect(await db.getFirstAsync("SELECT key FROM settings WHERE key LIKE 'sync.%'")).toBeNull();
    expect(tokens.current).toBeNull();
    expect(await pendingCount(db)).toBe(0);
  });

  it('a token refresh in flight does not bring the old tokens back after the wipe', async () => {
    const { db, server, tokens, deps } = await setup();
    server.accessValid = 'newer'; // the held 401 leads to a refresh
    await saveWeightDoc(db, w('2026-10-08', 80));
    const slow = gate();
    server.hold = slow.p;
    server.holdPath = '/auth/refresh'; // the 401 answers at once, the refresh request is the one that waits
    const run = syncOnce(deps);
    await new Promise((r) => setTimeout(r, 10));
    expect(server.calls.map((c) => c.path)).toEqual(['/sync', '/auth/refresh']);
    const discard = discardAll(db, tokens);
    slow.release();
    await discard;
    await run;
    expect(tokens.current).toBeNull();
  });

  it('a run for a user whose store was rebound stops writing', async () => {
    const { db, server, deps } = await setup();
    server.put('weights', { id: await naturalId(USER, 'weights', '2026-10-07'), version: 1, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, date: '2026-10-07', weight_kg: 79 });
    const slow = gate();
    server.hold = slow.p;
    const run = syncOnce(deps);
    await new Promise((r) => setTimeout(r, 10));
    await setKv(db, KEY_USER, OTHER_USER); // someone else owns the store now
    slow.release();
    expect((await run).status).toBe('paused');
    expect(await db.getFirstAsync('SELECT key FROM weights')).toBeNull();
  });
});

describe('pause nesting', () => {
  it('overlapping pauses nest: sync stays paused until the last one ends', async () => {
    const { deps } = await setup();
    await pauseSync();
    await pauseSync();
    resumeSync();
    expect((await syncOnce(deps)).status).toBe('paused');
    resumeSync();
    expect((await syncOnce(deps)).status).toBe('ok');
  });
});

describe('write lock', () => {
  it('a store write issued during a sync transaction waits for it, so check-write-clear stays atomic', async () => {
    const { db } = await setup();
    const ui = lockedDb(db as never) as unknown as typeof db;
    const hold = gate();
    const order: string[] = [];
    const sync = applyPulled(db, 'weights', '2026-10-08', async (txn) => {
      await txn.runAsync("INSERT OR REPLACE INTO weights (key, data) VALUES ('2026-10-08', ?)", JSON.stringify(w('2026-10-08', 80)));
      await hold.p; // the UI saves while the pulled write is open
      order.push('sync done');
    });
    await new Promise((r) => setTimeout(r, 5));
    const save = ui.runAsync('INSERT OR REPLACE INTO weights (key, data) VALUES (?, ?)', '2026-10-08', JSON.stringify(w('2026-10-08', 81))).then(() => order.push('ui write'));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]); // the UI write has not run inside the sync transaction
    hold.release();
    await Promise.all([sync, save]);
    expect(order).toEqual(['sync done', 'ui write']);
    // The UI edit came after the sync cleared its own entry, so it is still queued and will be pushed.
    expect(await pendingCount(db)).toBe(1);
    expect(JSON.parse((await db.getFirstAsync<{ data: string }>("SELECT data FROM weights WHERE key = '2026-10-08'"))!.data)).toMatchObject({ weight_kg: 81 });
  });

  it('a Progress save (weigh-in) during a sync transaction waits for it and stays queued', async () => {
    const { db } = await setup();
    const ui = lockedDb(db as never) as unknown as typeof db;
    const hold = gate();
    let syncDone = false;
    const sync = applyPulled(db, 'weights', '2026-10-07', async (txn) => {
      await txn.runAsync("INSERT OR REPLACE INTO weights (key, data) VALUES ('2026-10-07', ?)", JSON.stringify(w('2026-10-07', 80)));
      await hold.p;
      syncDone = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    let saved = false;
    const save = saveWeight(ui, { ...w('2026-10-08', 81), id: null } as never).then(() => (saved = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(saved).toBe(false);
    hold.release();
    await Promise.all([sync, save]);
    expect(syncDone).toBe(true);
    expect(await pendingCount(db)).toBe(1); // the weigh-in is queued; the pulled record is not
  });

  it('keeps running later tasks after one throws', async () => {
    await expect(writeLock.run(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    await expect(writeLock.run(async () => 1)).resolves.toBe(1);
  });
});

function Probe({ onReady }: { onReady: (s: ReturnType<typeof useSync> & ReturnType<typeof useProfile>) => void }) {
  const sync = useSync();
  const profile = useProfile();
  onReady({ ...sync, ...profile });
  return <Text>{profile.profile ? 'has profile' : 'no profile'}</Text>;
}

describe('pulled records reach the stores', () => {
  it('a returning user signs in on an empty device: the pulled profile loads and the gate does not send them to setup', async () => {
    const tokens = memoryTokens();
    const db = await openDb();
    const server = fakeServer(USER);
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    server.put('profiles', { id: await naturalId(USER, 'profiles', 'me'), version: 3, updated_at: '2026-10-09T05:00:00Z', deleted_at: null, sex: 'female', age: 30 });
    const api = createClient(API, async () => (await tokens.load())?.access ?? null);
    let latest!: ReturnType<typeof useSync> & ReturnType<typeof useProfile>;
    await render(
      <SyncProvider db={db} tokens={tokens} api={api}>
        <Stores db={db}>
          <Probe onReady={(s) => (latest = s)} />
        </Stores>
      </SyncProvider>,
    );
    await screen.findByText('no profile');
    const gateNow = () => gateRedirect({ status: latest.status, hasProfile: !!latest.profile, pathname: '/', firstOpen: false });
    expect(gateNow()).toBe('/setup');

    await act(async () => void (await latest.verifyCode('a@example.com', '123456')));
    await waitFor(() => expect(latest.last?.status).toBe('consent_required')); // nothing is pulled before consent
    await act(async () => {
      await latest.giveConsent();
      await latest.syncNow();
    });
    await screen.findByText('has profile');
    expect(latest.dataVersion).toBeGreaterThan(0);
    expect(gateNow()).toBeNull();
    expect(tokens.current?.access).toBe('access-verified');
  });
});

describe('refused records in the provider', () => {
  it('counts the record the server refused, keeps the rest syncing, and retry or discard changes the count', async () => {
    const { db, server, tokens, api } = await setup();
    server.accessValid = 'access-1';
    server.rejectIf = (table, r) => (table === 'weights' && (r.weight_kg as number) <= 0 ? 'weight_kg' : null);
    await saveWeightDoc(db, w('2026-10-07', 80));
    await saveWeightDoc(db, w('2026-10-08', -1));
    let latest!: ReturnType<typeof useSync>;
    const Grab = ({ onSync }: { onSync: (s: ReturnType<typeof useSync>) => void }) => {
      onSync(useSync());
      return null;
    };
    await render(
      <SyncProvider db={db} tokens={tokens} api={api}>
        <Grab onSync={(s) => (latest = s)} />
      </SyncProvider>,
    );
    await waitFor(() => expect(latest.signedIn).toBe(true));
    await waitFor(() => expect(latest.quarantined).toBe(1));
    expect(latest.last?.status).toBe('ok');
    expect(latest.pending).toBe(1);
    await act(async () => latest.retryQuarantined());
    await waitFor(() => expect(latest.quarantined).toBe(1)); // refused again
    await act(async () => latest.discardQuarantined());
    expect(latest.quarantined).toBe(0);
    expect(latest.pending).toBe(0);
  });
});
