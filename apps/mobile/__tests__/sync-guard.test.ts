/** @jest-environment node */
import { pendingCount } from '../src/db/outbox';
import { syncOnce } from '../src/sync/engine';
import { makeApi, verifyEmailCode } from '../src/sync/auth';
import { acceptTokenPair, signOut } from '../src/sync/guard';
import { getUserId, setKv, KEY_USER } from '../src/sync/store';
import { saveWeightDoc } from './sync-fixtures';
import { fakeServer, memoryTokens, openDb } from './sync-helpers';

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
  });

  it('signing in as the previous user again pushes the queue', async () => {
    const db = await openDb();
    const server = fakeServer(USER_A);
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    const tokens = memoryTokens();
    await setKv(db, KEY_USER, USER_A);
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
  });

  it('sign-out is blocked while changes are unsynced; discarding wipes them and the outbox', async () => {
    const db = await openDb();
    const tokens = memoryTokens({ access: 'a', refresh: 'r' });
    await setKv(db, KEY_USER, USER_A);
    await saveWeightDoc(db, w('2026-10-08'));
    await saveWeightDoc(db, w('2026-10-09'));
    expect(await signOut(db, tokens)).toBe(2);
    expect(tokens.current).not.toBeNull();
    expect(await signOut(db, tokens, { discard: true })).toBe(0);
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
  });
});
