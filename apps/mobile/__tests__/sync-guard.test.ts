/** @jest-environment node */
import { pendingCount } from '../src/db/outbox';
import { syncOnce } from '../src/sync/engine';
import { makeApi, verifyEmailCode } from '../src/sync/auth';
import { acceptTokenPair, signOut, withPhotosSettled } from '../src/sync/guard';
import { getUserId, setKv, KEY_USER } from '../src/sync/store';
import { saveWeightDoc } from './sync-fixtures';
import { fakeServer, memoryTokens, openDb, seedConsent, turns } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
// The photo vault is wiped whenever the store is (ADR 004, #251); its own behaviour is in photo-vault.test.ts.
const mockVault = { wipes: 0, failNext: false, told: [] as boolean[] };
jest.mock('../src/photos/vault', () => ({
  announceWipe: (ok: boolean) => void mockVault.told.push(ok),
  wipePhotos: async () => {
    if (mockVault.failNext) {
      mockVault.failNext = false;
      throw new Error('disk');
    }
    mockVault.wipes++;
  },
}));
beforeEach(() => {
  mockVault.wipes = 0;
  mockVault.failNext = false;
  mockVault.told = [];
});

const USER_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const USER_B = '0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f';
const pair = (id: string) => ({ access_token: `access-of-${id}`, refresh_token: `refresh-of-${id}`, user: { id, email: null, created_at: '2026-10-01T00:00:00Z' } });
const w = (date: string) => ({ id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date, weight_kg: 80 });

describe('sign-out and account switch guard (#31)', () => {
  it('first sign-in binds the store to the user; the same user signing in again keeps the queue', async () => {
    const db = await openDb();
    const tokens = memoryTokens();
    await saveWeightDoc(db, w('2026-10-08')); // made before any account existed
    expect(await acceptTokenPair(db, tokens, pair(USER_A))).toEqual({ kind: 'signed_in', wiped: false });
    expect(await getUserId(db)).toBe(USER_A);
    expect(await acceptTokenPair(db, tokens, pair(USER_A))).toEqual({ kind: 'signed_in', wiped: false });
    expect(await pendingCount(db)).toBe(1);
  });

  it('a record queued by user A is never pushed with user B\'s token: sign-in as B is refused and the tokens discarded', async () => {
    const db = await openDb();
    const server = fakeServer(USER_A);
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    await setKv(db, KEY_USER, USER_A);
    await seedConsent(db);
    await saveWeightDoc(db, w('2026-10-08'));
    // The session expired: the refresh token is dead, so the app is signed out with the change still queued.
    server.refreshOk = false;
    const api = makeApi('http://fake/api/v1', tokens);
    expect((await syncOnce({ db, api, tokens })).status).toBe('signed_out');
    expect(tokens.current).toBeNull();

    // Sign in as B through the real verify call.
    const b = { ...pair(USER_B), token_type: 'Bearer', access_token_expires_at: '', refresh_token_expires_at: '', new_user: true };
    (globalThis as { fetch: unknown }).fetch = async () => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const out = await verifyEmailCode(db, makeApi('http://fake/api/v1', tokens), tokens, 'b@example.com', '123456');
    expect(out).toEqual({ kind: 'refused', pending: 1 });
    expect(tokens.current).toBeNull();
    expect(await getUserId(db)).toBe(USER_A);
    expect(await pendingCount(db)).toBe(1);
    // Nothing of A went out: no /sync call at all was made with B's token.
    expect(server.calls.filter((c) => c.auth === `Bearer ${pair(USER_B).access_token}`)).toHaveLength(0);
    const id = '640dee2b-d92d-5a00-bd03-568962bf90ea';
    expect(server.get('weights', id)).toBeUndefined();
    // and a later sync has no tokens, so it cannot push either.
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    const callsBefore = server.calls.length;
    expect((await syncOnce({ db, api, tokens })).status).toBe('signed_out');
    expect(server.calls).toHaveLength(callsBefore);
    expect(server.get('weights', id)).toBeUndefined();
    expect(mockVault.wipes).toBe(0); // refused: A's photos stay with A's store
  });

  it('signing in as the previous user again pushes the queue', async () => {
    const db = await openDb();
    const server = fakeServer(USER_A);
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    const tokens = memoryTokens();
    await setKv(db, KEY_USER, USER_A);
    await seedConsent(db);
    await saveWeightDoc(db, w('2026-10-08'));
    server.accessValid = pair(USER_A).access_token;
    expect(await acceptTokenPair(db, tokens, pair(USER_A))).toEqual({ kind: 'signed_in', wiped: false });
    expect((await syncOnce({ db, api: makeApi('http://fake/api/v1', tokens), tokens })).status).toBe('ok');
    expect(server.pushed()).toHaveLength(1);
  });

  it('a different user with an empty queue wipes the previous user\'s store before the tokens are kept', async () => {
    const db = await openDb();
    const tokens = memoryTokens();
    await setKv(db, KEY_USER, USER_A);
    await db.runAsync("INSERT INTO profiles (key, data) VALUES ('me', '{}')");
    await db.runAsync('DELETE FROM sync_outbox'); // already synced
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('device.flag', '1')");
    expect(await acceptTokenPair(db, tokens, pair(USER_B))).toEqual({ kind: 'signed_in', wiped: true });
    expect(await db.getFirstAsync('SELECT key FROM profiles')).toBeNull();
    expect(await getUserId(db)).toBe(USER_B);
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'device.flag'")).not.toBeNull();
    expect(tokens.current?.access).toBe(`access-of-${USER_B}`);
    expect(mockVault.wipes).toBe(1);
  });

  it('a photo wipe that fails after the store wipe stays owed and is done before the next sign-in binds anyone', async () => {
    const db = await openDb();
    const tokens = memoryTokens();
    await setKv(db, KEY_USER, USER_A);
    await db.runAsync('DELETE FROM sync_outbox');
    mockVault.failNext = true;
    await expect(acceptTokenPair(db, tokens, pair(USER_B))).rejects.toThrow('disk');
    // The store is wiped and unbound, B holds no tokens, and A's photos are still owed a wipe.
    expect(await getUserId(db)).toBeNull();
    expect(tokens.current).toBeNull();
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'device.photos_wipe_pending'")).not.toBeNull();
    expect(mockVault.wipes).toBe(0);
    // Nothing is bound now, so B's next sign-in is not an account switch: the owed wipe still happens first.
    expect(await acceptTokenPair(db, tokens, pair(USER_B))).toEqual({ kind: 'signed_in', wiped: false });
    expect(mockVault.wipes).toBe(1);
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'device.photos_wipe_pending'")).toBeNull();
    expect(await getUserId(db)).toBe(USER_B);
  });

  it('success is announced only after the marker is cleared; a failed wipe or marker delete announces failure', async () => {
    const db = await openDb();
    const tokens = memoryTokens();
    const marker = () => db.getFirstAsync("SELECT value FROM settings WHERE key = 'device.photos_wipe_pending'");
    await setKv(db, 'device.photos_wipe_pending', '1');
    mockVault.failNext = true;
    await expect(acceptTokenPair(db, tokens, pair(USER_A))).rejects.toThrow('disk');
    expect(mockVault.told).toEqual([false]);
    // The wipe works but clearing the marker fails: still a failure, never a success (a screen would reload and loop).
    const failing = Object.assign(Object.create(db), {
      runAsync: (sql: string, ...a: unknown[]) => (/DELETE FROM settings/.test(sql) && a[0] === 'device.photos_wipe_pending' ? Promise.reject(new Error('full')) : db.runAsync(sql, ...(a as never[]))),
    });
    await expect(acceptTokenPair(failing, tokens, pair(USER_A))).rejects.toThrow('full');
    expect(mockVault.told).toEqual([false, false]);
    expect(await marker()).not.toBeNull();
    // Both steps work: the marker is cleared first, and only then is success announced.
    const logging = Object.assign(Object.create(db), {
      runAsync: async (sql: string, ...a: unknown[]) => {
        const r = await db.runAsync(sql, ...(a as never[]));
        if (/DELETE FROM settings/.test(sql) && a[0] === 'device.photos_wipe_pending') mockVault.told.push('marker cleared' as never);
        return r;
      },
    });
    expect(await acceptTokenPair(logging, tokens, pair(USER_A))).toEqual({ kind: 'signed_in', wiped: false });
    expect(mockVault.told).toEqual([false, false, 'marker cleared', true]);
    expect(await marker()).toBeNull();
  });

  it('a photo write holds the account lock from settling the owed wipe until it is written', async () => {
    const db = await openDb();
    const tokens = memoryTokens();
    const events: string[] = [];
    let finish = () => {};
    const write = withPhotosSettled(db, async () => {
      events.push('write started');
      await new Promise<void>((r) => (finish = r));
      events.push('write done');
    });
    await turns();
    const other = acceptTokenPair(db, tokens, pair(USER_A)).then(() => events.push('account operation'));
    await turns();
    expect(events).toEqual(['write started']); // the account operation (and any wipe in it) waits
    finish();
    await Promise.all([write, other]);
    expect(events).toEqual(['write started', 'write done', 'account operation']);
  });

  it('a failure reading the wipe marker is announced too', async () => {
    const db = await openDb();
    const broken = Object.assign(Object.create(db), {
      getFirstAsync: (sql: string, ...a: unknown[]) => (a.includes('device.photos_wipe_pending') ? Promise.reject(new Error('read')) : db.getFirstAsync(sql, ...(a as never[]))),
    });
    await expect(acceptTokenPair(broken, memoryTokens(), pair(USER_A))).rejects.toThrow('read');
    expect(mockVault.told).toEqual([false]);
  });

  it('sign-out is blocked while changes are unsynced; discarding wipes them and the outbox', async () => {
    const db = await openDb();
    const tokens = memoryTokens({ access: 'a', refresh: 'r' });
    await setKv(db, KEY_USER, USER_A);
    await saveWeightDoc(db, w('2026-10-08'));
    await saveWeightDoc(db, w('2026-10-09'));
    expect(await signOut(db, tokens)).toBe(2);
    expect(tokens.current).not.toBeNull();
    expect(mockVault.wipes).toBe(0);
    expect(await signOut(db, tokens, { discard: true })).toBe(0);
    expect(mockVault.wipes).toBe(1);
    expect(tokens.current).toBeNull();
    expect(await pendingCount(db)).toBe(0);
    expect(await db.getFirstAsync('SELECT key FROM weights')).toBeNull();
    expect(await getUserId(db)).toBeNull();
  });

  it('sign-out with nothing unsynced forgets the tokens and keeps the data', async () => {
    const db = await openDb();
    const tokens = memoryTokens({ access: 'a', refresh: 'r' });
    await setKv(db, KEY_USER, USER_A);
    expect(await signOut(db, tokens)).toBe(0);
    expect(tokens.current).toBeNull();
    expect(await getUserId(db)).toBe(USER_A);
    expect(mockVault.wipes).toBe(0);
  });
});
