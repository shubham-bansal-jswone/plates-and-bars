import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { createClient } from '@plate-and-bar/api';
import { COOKIE_FAILURES_BEFORE_PROBE, onSignInUnavailable, resetCookieHealth, signInUnavailable, trackCookieCall } from '../src/sync/cookieHealth';
import { verifyEmailCode } from '../src/sync/auth';
import { refreshSession, syncOnce } from '../src/sync/engine';
import { KEY_USER, setKv } from '../src/sync/store';
import { SIGN_IN_RECHECK_MS, SYNC_INTERVAL_MS, SyncProvider, useSync } from '../src/sync/SyncProvider';
import { webTokenStore } from '../src/sync/tokens';
import { markSignOutPending } from '../src/sync/webSession';
import { fakeServer, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

// Issue #744 / ADR 006: a web origin the backend does not list for cookie mode fails the CORS preflight of the cookie-mode calls
// with a network error. That must not look like "offline" and must not be retried in a loop.

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const API = 'http://fake/api/v1';
const N = COOKIE_FAILURES_BEFORE_PROBE;

interface Logged { path: string; transport: string | null; credentials: string; origin: string; cache: string }

function setupServer() {
  const s = fakeServer(USER);
  const log: Logged[] = [];
  const w = {
    s,
    log,
    /** The cookie-mode calls fail like a CORS preflight refusal: a network error, no response. */
    cookieBlocked: true,
    /** `/health` is unreachable too (really offline). */
    healthDown: false,
    /** What an unblocked refresh answers: 200 with a session, or 401. */
    refreshStatus: 200,
    /** The next refresh is never answered (aborts when its request is). */
    hang: false,
    calls: (path: string) => log.filter((l) => l.path === path).length,
    fetch: async (input: Request): Promise<Response> => {
      const url = new URL(input.url);
      const path = url.pathname.replace('/api/v1', '');
      log.push({ path, transport: input.headers.get('X-Auth-Transport'), credentials: input.credentials, origin: url.origin, cache: input.cache });
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (path === '/health') {
        if (w.healthDown) throw new TypeError('network down');
        return json(200, { status: 'ok' });
      }
      const cookiePath = path === '/auth/refresh' || path === '/auth/refresh/revoke' || path === '/auth/email/verify';
      if (cookiePath && w.cookieBlocked) throw new TypeError('Failed to fetch');
      if (path === '/auth/refresh/revoke') return new Response(null, { status: 204 });
      if (path === '/auth/refresh' && w.hang) {
        await new Promise<never>((_, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      if (path === '/auth/refresh') {
        if (w.refreshStatus !== 200) return json(w.refreshStatus, { code: 'unauthorized', message: 'x' });
        s.refreshes++;
        s.accessValid = `access-cookie-${s.refreshes}`;
        return json(200, { token_type: 'Bearer', access_token: s.accessValid, access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: '', refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: USER, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      if (path === '/auth/email/verify') return json(401, { code: 'unauthorized', message: 'x' });
      return s.fetch(input);
    },
  };
  (globalThis as { fetch: unknown }).fetch = w.fetch;
  return w;
}

class FakeStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}
let platform: jest.ReplaceProperty<string> | null = null;
const setPlatform = (os: 'web' | 'ios') => {
  platform?.restore();
  platform = jest.replaceProperty(Platform, 'OS', os);
};
beforeEach(() => {
  resetCookieHealth();
  Object.assign(globalThis, { localStorage: new FakeStorage(), sessionStorage: new FakeStorage() });
  const win = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (win && typeof win.addEventListener !== 'function') Object.assign(win, { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  platform?.restore();
  platform = null;
  resetCookieHealth();
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

async function setupDb() {
  const db = await openDb();
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  return db;
}
const clientFor = (tokens: { load(): Promise<{ access: string } | null> }) => createClient(API, async () => (await tokens.load())?.access ?? null);

describe('detection', () => {
  it(`${N} network failures of a cookie-mode call while /health answers: sign-in is unavailable, runs stop sending, status says so`, async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    const tokens = webTokenStore();
    const run = () => syncOnce({ db, api: clientFor(tokens), tokens });
    for (let i = 1; i < N; i++) {
      expect((await run()).status).toBe('offline');
      expect(srv.calls('/health')).toBe(0); // not asked before the count is reached
      expect(signInUnavailable()).toBe(false);
    }
    expect((await run()).status).toBe('offline'); // the failure that reaches the count; the probe runs after it
    await waitFor(() => expect(signInUnavailable()).toBe(true));
    expect(srv.calls('/health')).toBe(1);
    expect(srv.calls('/auth/refresh')).toBe(N);
    // From here nothing is sent: the run ends with its own status, with no request.
    expect((await run()).status).toBe('sign_in_unavailable');
    expect((await run()).status).toBe('sign_in_unavailable');
    expect(srv.calls('/auth/refresh')).toBe(N);
    expect(srv.calls('/sync')).toBe(0);
  });

  it('the probe is a plain GET /health on the API origin: no credentials, no cookie header', async () => {
    setPlatform('web');
    const srv = setupServer();
    const api = clientFor(webTokenStore());
    for (let i = 0; i < N; i++) await trackCookieCall(api, () => api.POST('/auth/refresh', { body: {} })).catch(() => undefined);
    await waitFor(() => expect(signInUnavailable()).toBe(true));
    const probe = srv.log.filter((l) => l.path === '/health');
    expect(probe).toHaveLength(1);
    expect(probe[0]).toMatchObject({ transport: null, origin: 'http://fake' });
    expect(probe[0]!.credentials).not.toBe('include');
    expect(probe[0]!.cache).toBe('no-store'); // a cached 200 must not hide an outage
  });

  it('if /health fails too this is really offline: nothing is flagged, and the count starts again', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.healthDown = true;
    const db = await setupDb();
    const tokens = webTokenStore();
    const run = () => syncOnce({ db, api: clientFor(tokens), tokens });
    for (let i = 0; i < 2 * N; i++) expect((await run()).status).toBe('offline');
    await waitFor(() => expect(srv.calls('/health')).toBe(2)); // once per N failures, not per failure
    expect(signInUnavailable()).toBe(false);
    expect(srv.calls('/auth/refresh')).toBe(2 * N); // still retried: this is the connection, not the site
  });

  it('an answer from a cookie-mode call, whatever its status, resets the count', async () => {
    setPlatform('web');
    const srv = setupServer();
    const api = clientFor(webTokenStore());
    const call = () => trackCookieCall(api, () => api.POST('/auth/refresh', { body: {} })).catch(() => undefined);
    for (let i = 0; i < N - 1; i++) await call();
    srv.cookieBlocked = false;
    srv.refreshStatus = 401;
    await call(); // answered (a 401 is an answer)
    srv.cookieBlocked = true;
    for (let i = 0; i < N - 1; i++) await call();
    expect(srv.calls('/health')).toBe(0);
    expect(signInUnavailable()).toBe(false);
  });

  it('a request that timed out is not a network failure of the site', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.cookieBlocked = false;
    srv.hang = true;
    const db = await setupDb();
    const tokens = webTokenStore();
    for (let i = 0; i < N + 1; i++) expect(await refreshSession({ db, api: clientFor(tokens), tokens, timeoutMs: 20 })).toBe('unavailable');
    expect(srv.calls('/health')).toBe(0);
    expect(signInUnavailable()).toBe(false);
  });

  it('native never probes: its calls are not cookie-mode', async () => {
    setPlatform('ios');
    const srv = setupServer();
    srv.cookieBlocked = true;
    const api = clientFor(webTokenStore());
    for (let i = 0; i < 2 * N; i++) await trackCookieCall(api, () => api.POST('/auth/refresh', { body: {} })).catch(() => undefined);
    expect(srv.calls('/health')).toBe(0);
    expect(signInUnavailable()).toBe(false);
  });

  it('a call that gets through clears the flag and tells the listeners', async () => {
    setPlatform('web');
    const srv = setupServer();
    const api = clientFor(webTokenStore());
    const seen: boolean[] = [];
    const off = onSignInUnavailable((v) => seen.push(v));
    for (let i = 0; i < N; i++) await trackCookieCall(api, () => api.POST('/auth/refresh', { body: {} })).catch(() => undefined);
    await waitFor(() => expect(signInUnavailable()).toBe(true));
    srv.cookieBlocked = false; // the operator fixed the site; a user action sends a cookie-mode call again
    await trackCookieCall(api, () => api.POST('/auth/refresh', { body: {} }));
    expect(signInUnavailable()).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
  });
});

describe('sign-in by code', () => {
  const verify = async (db: Awaited<ReturnType<typeof setupDb>>) => {
    const tokens = webTokenStore();
    return verifyEmailCode(db, clientFor(tokens), tokens, 'a@example.com', '123456');
  };

  it(`the ${N}th network failure of the code check says sign-in is unavailable; earlier ones say offline`, async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    for (let i = 1; i < N; i++) expect(await verify(db)).toEqual({ kind: 'error', reason: 'offline' });
    expect(await verify(db)).toEqual({ kind: 'error', reason: 'sign_in_unavailable' });
    expect(srv.calls('/health')).toBe(1);
  });

  it('a really offline device keeps saying offline', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.healthDown = true;
    const db = await setupDb();
    for (let i = 0; i < 2 * N; i++) expect(await verify(db)).toEqual({ kind: 'error', reason: 'offline' });
  });
});

describe('the scheduler stops by itself', () => {
  async function mount(db: Awaited<ReturnType<typeof setupDb>>, tokens: ReturnType<typeof webTokenStore>) {
    let latest!: ReturnType<typeof useSync>;
    const Grab = () => {
      latest = useSync();
      return null;
    };
    await render(
      <SyncProvider db={db} tokens={tokens} api={clientFor(tokens)}>
        <Grab />
      </SyncProvider>,
    );
    return { sync: () => latest };
  }
  const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));

  it('cold reload on a misconfigured site: a few attempts, then the message and no more requests for as long as the page is open', async () => {
    setPlatform('web');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const srv = setupServer();
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await advance(0);
    await advance(10 * SYNC_INTERVAL_MS);
    await waitFor(() => expect(sync().signInUnavailable).toBe(true));
    const refreshes = srv.calls('/auth/refresh');
    expect(refreshes).toBe(N);
    expect(sync().last?.status).toBe('sign_in_unavailable');
    expect(sync().signedIn).toBe(true); // the session is not known to be over, and local data keeps working
    await advance(SIGN_IN_RECHECK_MS * 2); // to minute 25: nothing but the slow re-check, once per 10 minutes
    expect(srv.calls('/auth/refresh')).toBe(refreshes + 2);
    expect(srv.calls('/health')).toBe(1);
  });

  it('a pending sign-out is retried a few times, then not in a loop', async () => {
    setPlatform('web');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const srv = setupServer();
    const db = await setupDb();
    markSignOutPending();
    await mount(db, webTokenStore());
    await advance(0);
    await advance(10 * SYNC_INTERVAL_MS);
    expect(signInUnavailable()).toBe(true);
    const revokes = srv.calls('/auth/refresh/revoke');
    expect(revokes).toBe(N);
    await advance(SIGN_IN_RECHECK_MS * 2);
    expect(srv.calls('/auth/refresh/revoke')).toBe(revokes + 2); // only the slow re-check, once per 10 minutes
  });

  it('once a cookie-mode call gets through again, syncing resumes on the next tick', async () => {
    setPlatform('web');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const srv = setupServer();
    const db = await setupDb();
    const tokens = webTokenStore();
    const { sync } = await mount(db, tokens);
    await advance(0);
    await advance(10 * SYNC_INTERVAL_MS);
    await waitFor(() => expect(sync().signInUnavailable).toBe(true));
    srv.cookieBlocked = false; // fixed; something (a sign-in attempt, an export) calls a cookie-mode endpoint and is answered
    const api = clientFor(tokens);
    await act(async () => void (await trackCookieCall(api, () => api.POST('/auth/refresh', { body: {} }))));
    await waitFor(() => expect(sync().signInUnavailable).toBe(false));
    await advance(SYNC_INTERVAL_MS);
    await waitFor(() => expect(sync().last?.status).toBe('ok'));
    expect(srv.calls('/sync')).toBeGreaterThan(0);
  });
});

describe('leaving the flagged state', () => {
  async function mountFlagged() {
    setPlatform('web');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const online: (() => void)[] = [];
    const win = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown };
    const had = [win.addEventListener, win.removeEventListener];
    const windowObj = (globalThis as unknown as { window?: Record<string, unknown> }).window;
    const hadWindow = windowObj ? [windowObj.addEventListener, windowObj.removeEventListener] : [];
    const add = (t: string, h: () => void) => void (t === 'online' && online.push(h));
    win.addEventListener = add;
    if (windowObj) windowObj.addEventListener = add;
    const restore = () => {
      win.addEventListener = had[0];
      win.removeEventListener = had[1];
      if (windowObj) {
        windowObj.addEventListener = hadWindow[0];
        windowObj.removeEventListener = hadWindow[1];
      }
    };
    const srv = setupServer();
    const db = await setupDb();
    const tokens = webTokenStore();
    let latest!: ReturnType<typeof useSync>;
    const Grab = () => {
      latest = useSync();
      return null;
    };
    await render(
      <SyncProvider db={db} tokens={tokens} api={clientFor(tokens)}>
        <Grab />
      </SyncProvider>,
    );
    const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
    await advance(0);
    await advance(10 * SYNC_INTERVAL_MS);
    await waitFor(() => expect(latest.signInUnavailable).toBe(true));
    return { srv, tokens, sync: () => latest, advance, online, restore };
  }

  it('the browser coming back online forgets the verdict, and runs try the refresh again', async () => {
    const { srv, sync, advance, online, restore } = await mountFlagged();
    try {
      const before = srv.calls('/auth/refresh');
      expect(online.length).toBeGreaterThan(0);
      await act(async () => online.forEach((h) => h()));
      expect(sync().signInUnavailable).toBe(false);
      await advance(SYNC_INTERVAL_MS);
      expect(srv.calls('/auth/refresh')).toBeGreaterThan(before);
    } finally {
      restore();
    }
  });

  it('Sync now tries exactly one refresh: a failure keeps the flag, a success clears it', async () => {
    const { srv, sync, advance, restore } = await mountFlagged();
    try {
      const before = srv.calls('/auth/refresh');
      await act(async () => void (await sync().syncNow()));
      expect(srv.calls('/auth/refresh')).toBe(before + 1);
      expect(sync().signInUnavailable).toBe(true);
      await advance(5 * SYNC_INTERVAL_MS);
      expect(srv.calls('/auth/refresh')).toBe(before + 1); // the one attempt did not reopen the loop
      srv.cookieBlocked = false; // fixed
      await act(async () => void (await sync().syncNow()));
      expect(sync().signInUnavailable).toBe(false);
      expect(sync().last?.status).toBe('ok');
    } finally {
      restore();
    }
  });

  it('a Sync now that needed no refresh does not leave an attempt behind for the scheduler', async () => {
    const { srv, tokens, sync, advance, restore } = await mountFlagged();
    try {
      await tokens.save({ access: srv.s.accessValid, refresh: '' });
      await act(async () => void (await sync().syncNow())); // a valid token: no refresh needed, ok
      expect(sync().last?.status).toBe('ok');
      srv.s.accessValid = 'rotated-elsewhere'; // the next data call is refused, so a run now needs a refresh
      const before = srv.calls('/auth/refresh');
      await advance(2 * SYNC_INTERVAL_MS);
      expect(srv.calls('/auth/refresh')).toBe(before);
      expect(sync().last?.status).toBe('sign_in_unavailable');
    } finally {
      restore();
    }
  });

  it('every 10 minutes one refresh is tried again by itself', async () => {
    const { srv, sync, advance, restore } = await mountFlagged();
    try {
      const before = srv.calls('/auth/refresh');
      await advance(SIGN_IN_RECHECK_MS);
      expect(srv.calls('/auth/refresh')).toBe(before + 1);
      expect(sync().signInUnavailable).toBe(true); // still blocked: stays flagged, not counting up again
      await advance(4 * 60_000); // the timer started at mount: the next check is at minute 20, now about minute 19
      expect(srv.calls('/auth/refresh')).toBe(before + 1);
      await advance(2 * 60_000);
      expect(srv.calls('/auth/refresh')).toBe(before + 2); // once per 10 minutes
      srv.cookieBlocked = false;
      await advance(SIGN_IN_RECHECK_MS);
      expect(sync().signInUnavailable).toBe(false);
    } finally {
      restore();
    }
  });
});
