import { createClient } from '@plate-and-bar/api';
import { refreshSession, syncOnce } from '../src/sync/engine';
import { signOut, withSyncPaused } from '../src/sync/guard';
import { KEY_USER, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';
import { saveWeightDoc } from './sync-fixtures';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER = '0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f';
const w = { id: null, version: 0, updated_at: '2026-10-09T06:00:00.000Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 };
const gate = () => {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
};
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const db = await openDb();
  const server = fakeServer(USER);
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const api = createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null);
  return { db, server, tokens, deps: { db, api, tokens } };
}

/** A sync run whose /auth/refresh request is in flight and held (the access token was rejected). */
async function runWithHeldRefresh() {
  const s = await setup();
  s.server.accessValid = 'newer';
  await saveWeightDoc(s.db, w);
  const slow = gate();
  s.server.hold = slow.p;
  s.server.holdPath = '/auth/refresh';
  const run = syncOnce(s.deps);
  await settle();
  expect(s.server.calls.map((c) => c.path)).toEqual(['/sync', '/auth/refresh']);
  return { ...s, slow, run };
}

describe('a rotated refresh pair is never dropped (#287)', () => {
  it('is saved when it arrives while sync is paused for an account operation', async () => {
    const { db, server, tokens, slow, run } = await runWithHeldRefresh();
    let seen: unknown = 'unset';
    const op = withSyncPaused(async () => {
      seen = await tokens.load(); // the operation starts only after the run has finished
    });
    slow.release();
    await op;
    await run;
    expect(server.refreshes).toBe(1);
    expect(seen).toEqual({ access: 'access-2', refresh: 'refresh-2' });
    expect(tokens.current).toEqual({ access: 'access-2', refresh: 'refresh-2' });
    expect(db).toBeTruthy();
  });

  it('a later refresh uses the rotated token, not the old one', async () => {
    const { server, tokens, deps, slow, run } = await runWithHeldRefresh();
    const op = withSyncPaused(async () => refreshSession(deps));
    slow.release();
    await op;
    await run;
    // refresh-1 was presented once only; a second use would be reuse and end the session.
    expect(server.calls.filter((c) => c.path === '/auth/refresh').map((c) => c.body.refresh_token)).toEqual(['refresh-1', 'refresh-2']);
    expect(tokens.current?.refresh).toBe('refresh-3');
  });

  it('Discard and sign out mid-refresh: the pair is saved but the run does not push again', async () => {
    const { db, server, tokens, slow, run } = await runWithHeldRefresh();
    const out = signOut(db, tokens, { discard: true });
    slow.release();
    await out;
    expect((await run).status).toBe('paused');
    expect(server.calls.map((c) => c.path)).toEqual(['/sync', '/auth/refresh']); // no second /sync with the discarded change
    expect(server.pushed()).toHaveLength(1);
    expect(server.get('weights', server.pushed()[0]?.id ?? '')).toBeUndefined();
    expect(tokens.current).toBeNull();
  });

  it('plain sign-out (store stays bound, nothing queued) mid-refresh: the late pair does not bring the session back', async () => {
    const s = await setup();
    s.server.accessValid = 'newer';
    const slow = gate();
    s.server.hold = slow.p;
    s.server.holdPath = '/auth/refresh';
    const run = syncOnce(s.deps);
    await settle();
    expect(s.server.calls.map((c) => c.path)).toEqual(['/sync', '/auth/refresh']);
    const out = signOut(s.db, s.tokens);
    slow.release();
    expect(await out).toBe(0);
    await run;
    expect(s.tokens.current).toBeNull();
  });

  it('is dropped when the store changed owner while the request was out', async () => {
    const { db, tokens, slow, run } = await runWithHeldRefresh();
    await setKv(db, KEY_USER, OTHER); // someone else owns the store now
    slow.release();
    await run;
    expect(tokens.current).toEqual({ access: 'access-1', refresh: 'refresh-1' });
  });

  it('a refresh answered 401 after the owner changed does not clear the other user\'s tokens', async () => {
    const { db, server, tokens, slow, run } = await runWithHeldRefresh();
    server.refreshOk = false;
    await setKv(db, KEY_USER, OTHER);
    slow.release();
    await run;
    expect(tokens.current).not.toBeNull();
  });
});

describe('refreshes are single-flight', () => {
  it('a refresh while the sync run is refreshing joins it: one request, one rotation', async () => {
    const { server, tokens, deps, slow, run } = await runWithHeldRefresh();
    const joined = refreshSession(deps); // no account lock on purpose: single-flight must hold by itself
    await settle();
    slow.release();
    expect(await joined).toBe('ok');
    await run;
    expect(server.refreshes).toBe(1);
    expect(tokens.current).toEqual({ access: 'access-2', refresh: 'refresh-2' });
  });

  it('two concurrent refreshSession calls make one request', async () => {
    const { server, tokens, deps } = await setup();
    const slow = gate();
    server.hold = slow.p;
    server.holdPath = '/auth/refresh';
    const a = refreshSession(deps);
    const b = refreshSession(deps);
    await settle();
    slow.release();
    expect(await Promise.all([a, b])).toEqual(['ok', 'ok']);
    expect(server.refreshes).toBe(1);
    expect(tokens.current?.refresh).toBe('refresh-2');
  });

  it('a finished refresh does not stick: the next refresh sends the new token', async () => {
    const { server, deps } = await setup();
    expect(await refreshSession(deps)).toBe('ok');
    expect(await refreshSession(deps)).toBe('ok');
    expect(server.calls.map((c) => c.body.refresh_token)).toEqual(['refresh-1', 'refresh-2']);
  });

  it('a refused refresh ends the session for every joiner and clears the tokens', async () => {
    const { server, tokens, deps } = await setup();
    server.refreshOk = false;
    const slow = gate();
    server.hold = slow.p;
    server.holdPath = '/auth/refresh';
    const a = refreshSession(deps);
    const b = refreshSession(deps);
    await settle();
    slow.release();
    expect(await Promise.all([a, b])).toEqual(['ended', 'ended']);
    expect(tokens.current).toBeNull();
  });

  it('a joiner gives up on its own timeout while the leader goes on and saves the pair', async () => {
    const { server, tokens, deps, slow, run } = await runWithHeldRefresh();
    const started = Date.now();
    expect(await refreshSession({ ...deps, timeoutMs: 50 })).toBe('unavailable');
    expect(Date.now() - started).toBeLessThan(500);
    slow.release();
    await run;
    expect(server.refreshes).toBe(1);
    expect(tokens.current).toEqual({ access: 'access-2', refresh: 'refresh-2' });
  });

  it('does not join a refresh for a different refresh token', async () => {
    const { server, tokens, deps, slow, run } = await runWithHeldRefresh();
    tokens.current = { access: 'x', refresh: 'refresh-other' };
    const other = refreshSession(deps);
    await settle();
    slow.release();
    await other;
    await run;
    expect(server.calls.filter((c) => c.path === '/auth/refresh').map((c) => c.body.refresh_token).sort()).toEqual(['refresh-1', 'refresh-other']);
  });

  it('does not join a refresh started for another owner', async () => {
    const { db, server, deps, slow, run } = await runWithHeldRefresh();
    await setKv(db, KEY_USER, OTHER);
    const other = refreshSession(deps);
    await settle();
    slow.release();
    await other;
    await run;
    expect(server.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(2);
  });

  it('two callers that share a token other than the one in flight join each other: one request for it', async () => {
    const { server, tokens, deps, slow, run } = await runWithHeldRefresh();
    tokens.current = { access: 'x', refresh: 'refresh-other' };
    const a = refreshSession(deps);
    const b = refreshSession(deps);
    await settle();
    slow.release();
    await Promise.all([a, b, run]);
    expect(server.calls.filter((c) => c.path === '/auth/refresh').map((c) => c.body.refresh_token).sort()).toEqual(['refresh-1', 'refresh-other']);
  });

  it('the same pair for another owner in flight is tracked: two callers for it make one request', async () => {
    const { db, server, deps, slow, run } = await runWithHeldRefresh();
    await setKv(db, KEY_USER, OTHER);
    const a = refreshSession(deps);
    const b = refreshSession(deps);
    await settle();
    slow.release();
    await Promise.all([a, b, run]);
    expect(server.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(2);
  });

  it('a joiner cut off by the leader\'s timeout reports unavailable, not offline', async () => {
    const { server, tokens, deps } = await setup();
    const slow = gate();
    server.hold = slow.p;
    server.holdPath = '/auth/refresh';
    const leader = refreshSession({ ...deps, timeoutMs: 40 });
    await settle(5);
    const joiner = refreshSession({ ...deps, timeoutMs: 5000 });
    expect(await leader).toBe('unavailable');
    expect(await joiner).toBe('unavailable');
    expect(tokens.current?.refresh).toBe('refresh-1'); // tokens kept
    slow.release();
  });

  it('cleanup guard: a failed refresh is not left tracked, so it can be retried with the same token', async () => {
    const { server, deps } = await setup();
    server.online = false;
    expect(await refreshSession(deps)).toBe('offline');
    server.online = true;
    expect(await refreshSession(deps)).toBe('ok');
    expect(server.calls.map((c) => c.body.refresh_token)).toEqual(['refresh-1']);
  });
});
