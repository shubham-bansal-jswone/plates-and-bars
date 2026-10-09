import { createClient } from '@plate-and-bar/api';
import { describeMeal } from '../src/ai/client';
import { syncOnce } from '../src/sync/engine';
import { withSyncPaused } from '../src/sync/guard';
import { KEY_USER, setKv } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const QUOTA = { limit: 10, remaining: 9, resets_at: '2026-10-10T00:00:00Z' };

/** The sync fake server plus a /ai/describe-meal route that checks the bearer token like the real one. */
async function setup() {
  const db = await openDb();
  const server = fakeServer(USER);
  const ai = { calls: 0, hold: null as null | Promise<void> };
  (globalThis as { fetch: unknown }).fetch = async (input: Request) => {
    const path = new URL(input.url).pathname.replace('/api/v1', '');
    if (path !== '/ai/describe-meal') return server.fetch(input);
    ai.calls++;
    if (ai.hold) await ai.hold;
    const ok = input.headers.get('Authorization') === `Bearer ${server.accessValid}`;
    return new Response(JSON.stringify(ok ? { items: [], quota: QUOTA } : { code: 'token_expired', message: 'x' }), { status: ok ? 200 : 401, headers: { 'Content-Type': 'application/json' } });
  };
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const api = createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null);
  return { db, server, ai, tokens, deps: { db, api, tokens } };
}
const gate = () => {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
};
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('AI call and token refresh', () => {
  it('a 401 refreshes under the account lock, then retries once and succeeds', async () => {
    const { server, ai, tokens, deps } = await setup();
    server.accessValid = 'newer';
    const slow = gate();
    server.hold = slow.p;
    server.holdPath = '/auth/refresh';
    const call = describeMeal(deps, '2 rotis');
    await settle();
    expect(server.calls.map((c) => c.path)).toEqual(['/auth/refresh']);
    // The refresh is held: the account lock is taken for it.
    expect(await Promise.race([withSyncPaused(async () => 'free'), settle(100).then(() => 'held')])).toBe('held');
    slow.release();
    expect(await call).toEqual({ kind: 'ok', data: { items: [], quota: QUOTA } });
    expect(server.refreshes).toBe(1);
    expect(ai.calls).toBe(2);
    expect(tokens.current).toEqual({ access: 'access-2', refresh: 'refresh-2' });
    expect(await withSyncPaused(async () => 'free')).toBe('free');
  });

  it('a refresh the server refuses ends the session: signed_out and the tokens are cleared', async () => {
    const { server, tokens, deps } = await setup();
    server.accessValid = 'newer';
    server.refreshOk = false;
    expect(await describeMeal(deps, '2 rotis')).toEqual({ kind: 'signed_out' });
    expect(tokens.current).toBeNull();
  });

  it('a sync run refreshing at the same time is waited for: its rotated pair is kept and the AI call just retries', async () => {
    const { server, ai, tokens, deps } = await setup();
    server.accessValid = 'newer'; // both the sync run and the AI call get a 401
    const slow = gate();
    server.hold = slow.p;
    server.holdPath = '/auth/refresh';
    const run = syncOnce(deps);
    await settle();
    expect(server.calls.map((c) => c.path)).toEqual(['/sync', '/auth/refresh']);
    const call = describeMeal(deps, '2 rotis');
    await settle();
    slow.release();
    expect(await call).toEqual({ kind: 'ok', data: { items: [], quota: QUOTA } });
    expect((await run).status).toBe('ok');
    expect(server.refreshes).toBe(1); // the AI path did not refresh with the already-rotated token
    expect(tokens.current).toEqual({ access: 'access-2', refresh: 'refresh-2' });
    expect(ai.calls).toBe(2);
  });

  it('signing out while a call is out drops the answer', async () => {
    const { ai, tokens, deps } = await setup();
    const slow = gate();
    ai.hold = slow.p;
    const call = describeMeal(deps, '2 rotis');
    await settle();
    await tokens.clear(); // plain sign-out
    slow.release();
    expect(await call).toEqual({ kind: 'signed_out' });
  });
});
