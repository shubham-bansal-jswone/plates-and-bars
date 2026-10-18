import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import { createClient } from '@plate-and-bar/api';
import { REFRESH_TIMEOUT_MS } from '../src/sync/timeout';
import { REFRESH_RETRY_MS, SYNC_INTERVAL_MS, SyncProvider, useSync } from '../src/sync/SyncProvider';
import { KEY_USER, setKv } from '../src/sync/store';
import { webTokenStore } from '../src/sync/tokens';
import { fakeServer, memoryTokens, openDb, seedConsent, turns } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

// Issue #762 (follow-ups to #250 / ADR 006): cross-tab sign-out, bounded refresh with the lock held for the request, offline backoff.

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const API = 'http://fake/api/v1';
const flush = () => new Promise<void>((r) => setImmediate(r));

/** A BroadcastChannel shared by every instance in the process, like the tabs of one browser. A sender never hears itself. */
class FakeChannel {
  static all = new Set<FakeChannel>();
  private handlers = new Set<(e: { data: unknown }) => void>();
  constructor(readonly name: string) {
    FakeChannel.all.add(this);
  }
  addEventListener(type: string, h: (e: { data: unknown }) => void) {
    if (type === 'message') this.handlers.add(h);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) if (c !== this && c.name === this.name) setImmediate(() => c.handlers.forEach((h) => h({ data })));
  }
  close() {
    FakeChannel.all.delete(this);
  }
}

class FakeStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

/** The server: cookie-mode refresh (optionally held), revoke, and the fake data server behind it. */
function setupServer() {
  const s = fakeServer(USER);
  const w = {
    s,
    log: [] as string[],
    /** When set, the next /auth/refresh waits for it (and ends with an AbortError if its request is aborted); later ones are not held. */
    gate: null as null | Promise<void>,
    /** Paths that fail at the network level (no response). */
    down: new Set<string>(),
    calls: (path: string) => w.log.filter((p) => p === path).length,
    fetch: async (input: Request): Promise<Response> => {
      const path = new URL(input.url).pathname.replace('/api/v1', '');
      w.log.push(path);
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (w.down.has(path)) throw new TypeError('network down');
      if (path === '/auth/refresh/revoke') return new Response(null, { status: 204 });
      if (path === '/auth/refresh') {
        const gate = w.gate;
        w.gate = null;
        if (gate) {
          const aborted = new Promise<never>((_, reject) => {
            const fire = () => reject(new DOMException('aborted', 'AbortError'));
            if (input.signal.aborted) fire();
            else input.signal.addEventListener('abort', fire, { once: true });
          });
          aborted.catch(() => undefined);
          await Promise.race([gate, aborted]);
        }
        s.refreshes++;
        s.accessValid = `access-cookie-${s.refreshes}`;
        return json(200, { token_type: 'Bearer', access_token: s.accessValid, access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: '', refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: USER, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      // Every access token this server issued stays valid (tabs refresh independently), unlike the single-token fake behind it.
      const headers = new Headers(input.headers);
      if (headers.get('Authorization')?.startsWith('Bearer access-cookie-')) headers.set('Authorization', `Bearer ${s.accessValid}`);
      return s.fetch(new Request(input, { headers }));
    },
  };
  (globalThis as { fetch: unknown }).fetch = w.fetch;
  return w;
}

let local: FakeStorage;
let platforms: jest.ReplaceProperty<string>[] = [];
let channelBefore: unknown;
let locksBefore: PropertyDescriptor | undefined;

/** One mutex shared by every tab, like the browser's Web Locks. */
function installLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const nav = globalThis.navigator as unknown as { locks?: unknown };
  locksBefore = Object.getOwnPropertyDescriptor(nav, 'locks');
  Object.defineProperty(nav, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, cb: () => Promise<unknown>) => {
        const run = tail.then(cb);
        tail = run.catch(() => undefined);
        return run;
      },
    },
  });
}

beforeEach(() => {
  local = new FakeStorage();
  Object.assign(globalThis, { localStorage: local, sessionStorage: new FakeStorage() });
  channelBefore = (globalThis as Record<string, unknown>).BroadcastChannel;
  (globalThis as Record<string, unknown>).BroadcastChannel = FakeChannel;
  // The web build listens for 'online' on window; the test environment's window has no event methods.
  const win = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (win && typeof win.addEventListener !== 'function') Object.assign(win, { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterEach(() => {
  cleanup();
  platforms.forEach((p) => p.restore());
  platforms = [];
  FakeChannel.all.clear();
  (globalThis as Record<string, unknown>).BroadcastChannel = channelBefore;
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;
  const nav = globalThis.navigator as unknown as { locks?: unknown };
  if (locksBefore) Object.defineProperty(nav, 'locks', locksBefore);
  else delete nav.locks;
  locksBefore = undefined;
  jest.useRealTimers();
});

/**
 * One browser tab: its own copy of every sync module (its own in-flight refresh map, token store and BroadcastChannel), its own
 * store, sharing only what a browser shares: local storage, the lock, the channel bus and the server.
 */
async function openTab() {
  type Mods = { engine: typeof import('../src/sync/engine'); guard: typeof import('../src/sync/guard'); tokens: typeof import('../src/sync/tokens'); webSession: typeof import('../src/sync/webSession') };
  let mods!: Mods;
  jest.isolateModules(() => {
    // The real Platform is looked up lazily through the active registry, so a replaced property would not reach this copy.
    jest.doMock('react-native', () => ({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default } }));
    jest.doMock('expo-secure-store', () => ({}));
    /* eslint-disable @typescript-eslint/no-require-imports */
    mods = { engine: require('../src/sync/engine'), guard: require('../src/sync/guard'), tokens: require('../src/sync/tokens'), webSession: require('../src/sync/webSession') };
    /* eslint-enable @typescript-eslint/no-require-imports */
    jest.dontMock('react-native');
    jest.dontMock('expo-secure-store');
  });
  const db = await openDb();
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const tokens = mods.tokens.webTokenStore();
  const api = createClient(API, async () => (await tokens.load())?.access ?? null);
  return { db, tokens, api, onRemote: (f: () => void) => mods.webSession.onRemoteSignOut(f), run: (extra: { refreshTimeoutMs?: number } = {}) => mods.engine.syncOnce({ db, api, tokens, ...extra }), signOut: () => mods.guard.signOut(db, tokens) };
}

describe('cross-tab sign-out (BroadcastChannel)', () => {
  it('signing out in one tab drops the other tabs access token at once, and its next run is signed out without a refresh', async () => {
    const srv = setupServer();
    const a = await openTab();
    const b = await openTab();
    await a.tokens.save({ access: srv.s.accessValid, refresh: '' });
    await b.tokens.save({ access: srv.s.accessValid, refresh: '' });
    expect(await a.signOut()).toBe(0);
    await flush();
    expect(await b.tokens.load()).toBeNull();
    expect(await a.tokens.load()).toBeNull();
    expect((await b.run()).status).toBe('signed_out');
    expect(srv.calls('/auth/refresh')).toBe(0);
    expect(srv.calls('/sync')).toBe(0);
  });

  it('the signing-out tab is not told about its own sign-out, another tab is', async () => {
    setupServer();
    const heardA = jest.fn();
    const heardOther = jest.fn();
    let signOutA!: () => Promise<number>;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../src/sync/webSession').onRemoteSignOut(heardOther); // a third tab, its own copy
    });
    const a = await openTab();
    signOutA = a.signOut;
    a.onRemote(heardA); // tab A's own copy of the module
    await signOutA();
    await flush();
    expect(heardA).not.toHaveBeenCalled();
    expect(heardOther).toHaveBeenCalledTimes(1); // the channel does deliver
  });

  it('the message carries no token and no user data', async () => {
    setupServer();
    const a = await openTab();
    const sent: unknown[] = [];
    const original = FakeChannel.prototype.postMessage;
    jest.spyOn(FakeChannel.prototype, 'postMessage').mockImplementation(function (this: FakeChannel, data: unknown) {
      sent.push(data);
      original.call(this, data);
    });
    await a.tokens.save({ access: 'secret-access', refresh: '' });
    await a.signOut();
    expect(sent).toEqual([{ type: 'signout' }]);
    jest.restoreAllMocks();
  });

  it('a refresh that finishes after another tab signed out does not bring the access token back', async () => {
    const srv = setupServer();
    let release!: () => void;
    srv.gate = new Promise<void>((r) => (release = r));
    const a = await openTab();
    const b = await openTab();
    const running = b.run(); // cold tab: refreshes from the cookie, held at the server
    await waitFor(() => expect(srv.calls('/auth/refresh')).toBe(1));
    await a.tokens.save({ access: 'x', refresh: '' });
    await a.signOut(); // flag set and message sent while b's refresh is in flight
    await flush();
    release();
    expect((await running).status).toBe('signed_out');
    expect(await b.tokens.load()).toBeNull();
    expect(srv.calls('/sync')).toBe(0);
    // The cookie that response set is ended too: revoked from this tab, under the lock.
    expect(srv.calls('/auth/refresh/revoke')).toBe(1);
  });
});

describe('cross-tab sign-out (storage event fallback)', () => {
  it('with no BroadcastChannel a tab drops its access token on the storage event of the pending flag', async () => {
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
    const handlers: ((e: { key?: string | null; newValue?: string | null }) => void)[] = [];
    const g = globalThis as unknown as { addEventListener?: unknown };
    const hadListener = g.addEventListener;
    g.addEventListener = (t: string, h: (typeof handlers)[number]) => void (t === 'storage' && handlers.push(h));
    try {
      setupServer();
      const b = await openTab();
      await b.tokens.save({ access: 'in-memory', refresh: '' });
      expect(handlers).toHaveLength(1);
      handlers[0]!({ key: 'something.else', newValue: '1' });
      handlers[0]!({ key: 'pb.signout_pending', newValue: null }); // the flag cleared: a sign-in, not a sign-out
      expect((await b.tokens.load())?.access).toBe('in-memory');
      handlers[0]!({ key: 'pb.signout_pending', newValue: '1' });
      expect(await b.tokens.load()).toBeNull();
    } finally {
      g.addEventListener = hadListener;
    }
  });
});

describe('the refresh request is bounded and holds the lock only as long as it runs', () => {
  it('a refresh from inside a sync run gives up at the timeout: unavailable, not a hang', async () => {
    const srv = setupServer();
    srv.gate = new Promise<void>(() => undefined); // the server never answers
    const a = await openTab();
    await a.tokens.save({ access: 'expired', refresh: '' }); // /sync answers 401, so the run refreshes
    const r = await a.run({ refreshTimeoutMs: 40 });
    expect(r.status).toBe('unavailable');
    expect(srv.calls('/auth/refresh')).toBe(1);
    expect(await a.tokens.load()).not.toBeNull(); // a timeout never signs out
  });

  it('a run that failed on the refresh request says so, in the result; a failed data request does not', async () => {
    const srv = setupServer();
    const a = await openTab();
    srv.down.add('/auth/refresh');
    expect(await a.run()).toMatchObject({ status: 'offline', viaRefresh: true });
    srv.down.clear();
    srv.gate = new Promise<void>(() => undefined);
    expect(await a.run({ refreshTimeoutMs: 30 })).toMatchObject({ status: 'unavailable', viaRefresh: true });
    srv.down.add('/sync');
    await a.tokens.save({ access: srv.s.accessValid, refresh: '' });
    const r = await a.run();
    expect(r.status).toBe('offline');
    expect(r.viaRefresh).toBeUndefined();
  });

  it('another tab waits for the lock while the refresh runs, and its request goes out only once the first gave up', async () => {
    // The first request's timeout runs on a fake clock: it fires when the test says so, not when a loaded machine happens to take 120 ms.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    installLocks();
    const srv = setupServer();
    srv.gate = new Promise<void>(() => undefined);
    const a = await openTab();
    const b = await openTab();
    const first = a.run({ refreshTimeoutMs: 120 });
    await waitFor(() => expect(srv.calls('/auth/refresh')).toBe(1));
    const second = b.run({ refreshTimeoutMs: 120 });
    await turns(); // b has had every chance to send its request
    expect(srv.calls('/auth/refresh')).toBe(1); // b is still queued behind the lock
    jest.advanceTimersByTime(120); // the first request's timeout
    expect((await first).status).toBe('unavailable');
    expect((await second).status).toBe('ok');
    expect(srv.calls('/auth/refresh')).toBe(2);
  });

  it('a refresh that settles in time releases the lock to the next tab at once', async () => {
    installLocks();
    const srv = setupServer();
    let release!: () => void;
    srv.gate = new Promise<void>((r) => (release = r));
    const a = await openTab();
    const b = await openTab();
    const first = a.run({ refreshTimeoutMs: 5000 });
    await waitFor(() => expect(srv.calls('/auth/refresh')).toBe(1));
    const second = b.run({ refreshTimeoutMs: 5000 });
    await flush();
    expect(srv.calls('/auth/refresh')).toBe(1);
    release();
    expect((await first).status).toBe('ok');
    expect((await second).status).toBe('ok');
  });

  it('the timeout stays under the server grace window of 60 s, so a retry after it is not reuse of a rotated token', () => {
    expect(REFRESH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(REFRESH_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe('web provider', () => {
  const setWeb = () => platforms.push(jest.replaceProperty(Platform, 'OS', 'web'));
  const mount = (tokens: ReturnType<typeof webTokenStore> | ReturnType<typeof memoryTokens>) => mountWith(tokens);
  async function mountWith(tokens: ReturnType<typeof webTokenStore> | ReturnType<typeof memoryTokens>) {
    const db = await openDb();
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    let latest!: ReturnType<typeof useSync>;
    const Grab = () => {
      latest = useSync();
      return null;
    };
    const view = await render(
      <SyncProvider db={db} tokens={tokens} api={createClient(API, async () => (await tokens.load())?.access ?? null)}>
        <Grab />
      </SyncProvider>,
    );
    return { sync: () => latest, unmount: () => view.unmount() };
  }

  it('a sign-out in another tab shows this tab signed out and clears its tokens', async () => {
    setWeb();
    const srv = setupServer();
    const tokens = memoryTokens({ access: srv.s.accessValid, refresh: '' });
    const { sync } = await mount(tokens);
    await waitFor(() => expect(sync().signedIn).toBe(true));
    const other = new FakeChannel('pb-session'); // another tab's channel
    await act(async () => {
      other.postMessage({ type: 'signout' });
      await flush();
    });
    await waitFor(() => expect(sync().signedIn).toBe(false));
    expect(tokens.current).toBeNull();
    expect(sync().linked).toBe(true); // local data and its binding stay
  });

  it('offline runs back off 30 s, 1 min, 2 min, and a back-online event starts again from 30 s', async () => {
    setWeb();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const win = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown };
    const had = [win.addEventListener, win.removeEventListener];
    const onlineHandlers: (() => void)[] = [];
    win.addEventListener = (t: string, h: () => void) => void (t === 'online' && onlineHandlers.push(h));
    win.removeEventListener = () => undefined;
    const windowObj = (globalThis as unknown as { window?: Record<string, unknown> }).window;
    const hadWindow = windowObj ? [windowObj.addEventListener, windowObj.removeEventListener] : [];
    if (windowObj) {
      windowObj.addEventListener = win.addEventListener;
      windowObj.removeEventListener = win.removeEventListener;
    }
    try {
      const srv = setupServer();
      srv.s.online = false; // /sync fails at the network level
      const tokens = memoryTokens({ access: srv.s.accessValid, refresh: '' });
      const { sync } = await mount(tokens);
      const syncs = () => srv.calls('/sync');
      const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
      await advance(0);
      await waitFor(() => expect(sync().signedIn).toBe(true));
      await advance(0);
      expect(syncs()).toBe(1); // t = 0
      await advance(SYNC_INTERVAL_MS);
      expect(syncs()).toBe(2); // t = 30 s
      await advance(SYNC_INTERVAL_MS);
      expect(syncs()).toBe(2); // t = 60 s: held for a minute after the second failure
      await advance(SYNC_INTERVAL_MS);
      expect(syncs()).toBe(3); // t = 90 s
      await advance(3 * SYNC_INTERVAL_MS);
      expect(syncs()).toBe(3); // t = 180 s: held for two minutes
      await advance(SYNC_INTERVAL_MS);
      expect(syncs()).toBe(4); // t = 210 s
      expect(sync().last?.status).toBe('offline');
      // back online: runs at once and the wait is short again
      expect(onlineHandlers.length).toBeGreaterThan(0);
      await act(async () => {
        onlineHandlers.forEach((h) => h());
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(syncs()).toBe(5);
      await advance(SYNC_INTERVAL_MS);
      expect(syncs()).toBe(6); // 30 s after the online run, not 4 minutes
    } finally {
      win.addEventListener = had[0];
      win.removeEventListener = had[1];
      if (windowObj) {
        windowObj.addEventListener = hadWindow[0];
        windowObj.removeEventListener = hadWindow[1];
      }
    }
  });

  /** Mounts the web provider with every /auth/refresh request timestamped (ms since mount) in `sent`. */
  async function timedRefreshes(setup: (srv: ReturnType<typeof setupServer>) => void) {
    setWeb();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const srv = setupServer();
    const t0 = Date.now();
    const sent: number[] = [];
    const expire = { syncs: 0 }; // this many next /sync calls are answered 401 (the access token ran out), which makes the run refresh
    const base = srv.fetch;
    srv.fetch = async (input: Request) => {
      const path = new URL(input.url).pathname;
      if (path.endsWith('/auth/refresh')) sent.push(Date.now() - t0);
      if (path.endsWith('/sync') && expire.syncs > 0) {
        expire.syncs--;
        return new Response(JSON.stringify({ code: 'token_expired', message: 'x' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      return base(input);
    };
    (globalThis as { fetch: unknown }).fetch = srv.fetch;
    setup(srv);
    const { sync, unmount } = await mount(webTokenStore());
    const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
    await advance(0);
    await waitFor(() => expect(sync().signedIn).toBe(true));
    await advance(0);
    return { sent, advance, expire, now: sync, unmount };
  }

  it('a failed refresh request is retried 20 s after the failure by its own timer, not on the next interval tick (#809)', async () => {
    const { sent, advance } = await timedRefreshes((srv) => srv.down.add('/auth/refresh'));
    const n = sent.length;
    expect(n).toBeGreaterThan(0);
    await advance(REFRESH_RETRY_MS - 1);
    expect(sent.length).toBe(n);
    await advance(1);
    expect(sent.length).toBe(n + 1);
    expect((sent[n] ?? 0) - (sent[n - 1] ?? 0)).toBe(REFRESH_RETRY_MS);
  });

  it('every ambiguous refresh failure in a row gets the fast retry: 20 s each, no cap (#813 review)', async () => {
    const { sent, advance } = await timedRefreshes((srv) => srv.down.add('/auth/refresh'));
    const n = sent.length;
    for (let i = 1; i <= 4; i++) {
      await advance(REFRESH_RETRY_MS);
      expect(sent.length).toBe(n + i);
      expect((sent[n + i - 1] ?? 0) - (sent[n + i - 2] ?? 0)).toBe(REFRESH_RETRY_MS);
    }
  });

  /** Makes navigator.onLine report `value` (Node has none) until the returned function is called. */
  const fakeOnLine = (value: boolean) => {
    const nav = globalThis.navigator as unknown as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(nav, 'onLine');
    Object.defineProperty(nav, 'onLine', { configurable: true, get: () => value });
    return () => (had ? Object.defineProperty(nav, 'onLine', had) : void delete nav.onLine);
  };

  it('web offline: no fast retry is scheduled while navigator.onLine is false, and the online event runs at once', async () => {
    setWeb();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const restoreOnLine = fakeOnLine(false);
    const win = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown };
    const had = [win.addEventListener, win.removeEventListener];
    const onlineHandlers: (() => void)[] = [];
    win.addEventListener = (t: string, h: () => void) => void (t === 'online' && onlineHandlers.push(h));
    win.removeEventListener = () => undefined;
    const windowObj = (globalThis as unknown as { window?: Record<string, unknown> }).window;
    const hadWindow = windowObj ? [windowObj.addEventListener, windowObj.removeEventListener] : [];
    if (windowObj) {
      windowObj.addEventListener = win.addEventListener;
      windowObj.removeEventListener = win.removeEventListener;
    }
    try {
      const srv = setupServer();
      srv.down.add('/auth/refresh');
      const tokens = memoryTokens({ access: 'stale', refresh: 'r' }); // the sync answers 401, so the run refreshes
      const { sync } = await mount(tokens);
      const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
      await advance(0);
      await waitFor(() => expect(sync().signedIn).toBe(true));
      await advance(0);
      const n = srv.calls('/auth/refresh');
      expect(n).toBeGreaterThan(0);
      await advance(REFRESH_RETRY_MS + 5_000);
      expect(srv.calls('/auth/refresh')).toBe(n); // no 20 s retry; the next run is the normal 30 s backoff
      expect(onlineHandlers.length).toBeGreaterThan(0);
      await act(async () => {
        onlineHandlers.forEach((h) => h());
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(srv.calls('/auth/refresh')).toBe(n + 1); // back online: runs at once
    } finally {
      restoreOnLine();
      win.addEventListener = had[0];
      win.removeEventListener = had[1];
      if (windowObj) {
        windowObj.addEventListener = hadWindow[0];
        windowObj.removeEventListener = hadWindow[1];
      }
    }
  });

  it('native: the fast retry does not look at navigator.onLine, and coming back to the foreground runs at once and cancels it', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const restoreOnLine = fakeOnLine(false);
    let onChange: ((s: string) => void) | undefined;
    const original = AppState.addEventListener;
    AppState.addEventListener = ((_t: string, h: (s: string) => void) => {
      onChange = h;
      return { remove: () => undefined };
    }) as never;
    try {
      const srv = setupServer();
      srv.down.add('/auth/refresh');
      const tokens = memoryTokens({ access: 'stale', refresh: 'r' }); // the sync answers 401, so the run refreshes
      const { sync } = await mountWith(tokens);
      const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
      await advance(0);
      await waitFor(() => expect(sync().signedIn).toBe(true));
      await advance(0);
      const n = srv.calls('/auth/refresh');
      expect(n).toBeGreaterThan(0);
      await advance(REFRESH_RETRY_MS);
      expect(srv.calls('/auth/refresh')).toBe(n + 1); // retried at 20 s although navigator says offline
      await act(async () => {
        onChange?.('active');
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(srv.calls('/auth/refresh')).toBe(n + 2); // foreground: at once
    } finally {
      restoreOnLine();
      AppState.addEventListener = original;
    }
  });

  it('web with navigator.onLine stuck false: a refresh that times out still gets the fast retry within 40 s (#813 review)', async () => {
    const restoreOnLine = fakeOnLine(false);
    try {
      const k = { n: 0 };
      const { sent, advance } = await timedRefreshes(() => {
        const inner = globalThis.fetch;
        (globalThis as { fetch: unknown }).fetch = async (input: Request) => {
          if (!new URL(input.url).pathname.endsWith('/auth/refresh')) return inner(input);
          await inner(input).catch(() => undefined); // lets timedRefreshes stamp the send
          k.n++;
          if (k.n === 2) {
            await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
          }
          throw new TypeError('network down'); // request 1 fails at once: offline, and no fast retry while onLine is false
        };
      });
      await advance(300_000);
      // Request 2 (sent on the normal schedule) times out: the request got somewhere, so request 3 follows within 40 s.
      expect((sent[2] ?? Infinity) - (sent[1] ?? 0)).toBeLessThanOrEqual(40_000);
    } finally {
      restoreOnLine();
    }
  });

  /** The reviewer's probe: the first refresh fails at once (never reached the server), the Nth hangs to the timeout (it may have rotated). */
  it.each([2, 3, 4])('a refresh that hangs as request %i of a failure streak (request 1 is the mount refresh) is retried within 40 s of its send (#813 review)', async (hang) => {
    const k = { n: 0 };
    const { sent, advance } = await timedRefreshes(() => {
      const inner = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = async (input: Request) => {
        if (!new URL(input.url).pathname.endsWith('/auth/refresh')) return inner(input);
        await inner(input).catch(() => undefined); // lets timedRefreshes stamp the send
        k.n++;
        if (k.n === hang) {
          await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
        }
        throw new TypeError('network down');
      };
    });
    await advance(300_000);
    const gap = (sent[hang] ?? Infinity) - (sent[hang - 1] ?? 0); // the mount refresh is request 1
    expect(gap).toBeLessThanOrEqual(REFRESH_TIMEOUT_MS + REFRESH_RETRY_MS);
    expect(gap).toBeLessThanOrEqual(40_000);
  });

  /** Answers every /auth/refresh with `status`, counting them; everything else goes to the fake server. */
  const refreshAnswers = (status: number, hits: { n: number }) => () => {
    const inner = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = async (input: Request) => {
      if (!new URL(input.url).pathname.endsWith('/auth/refresh')) return inner(input);
      hits.n++;
      return new Response(JSON.stringify({ code: 'x', message: 'x' }), { status, headers: { 'Content-Type': 'application/json' } });
    };
  };

  it('a definite refusal of the refresh (a 403, as for a wrong Origin) is not retried at 20 s: it follows the normal schedule', async () => {
    const hits = { n: 0 };
    const { advance } = await timedRefreshes(refreshAnswers(403, hits));
    const n = hits.n;
    expect(n).toBeGreaterThan(0);
    await advance(REFRESH_RETRY_MS + 5_000); // no 20 s retry; the next run is 30 s after the refusal (t = 30 s, not 20 s)
    expect(hits.n).toBe(n);
  });

  it('a 5xx on the refresh gets the fast retry', async () => {
    const hits = { n: 0 };
    const { advance } = await timedRefreshes(refreshAnswers(503, hits));
    const n = hits.n;
    expect(n).toBeGreaterThan(0); // the mount run's refresh
    await advance(REFRESH_RETRY_MS);
    expect(hits.n).toBe(n + 1);
  });

  it('two runs joined to one failing sync leave one tracked retry: unmounting cancels it, nothing goes out 20 s later (#813 review)', async () => {
    const h = { srv: undefined as undefined | ReturnType<typeof setupServer> };
    const { sent, advance, now, unmount, expire } = await timedRefreshes((srv) => void (h.srv = srv));
    (h.srv as ReturnType<typeof setupServer>).down.add('/auth/refresh');
    expire.syncs = 2; // the run behind both calls is answered 401 and needs a refresh, which fails; a stray retry would be answered 401 too
    await act(async () => void (await Promise.all([now().syncNow(), now().syncNow()])));
    expect(now().last?.viaRefresh).toBe(true);
    const n = sent.length;
    await act(async () => unmount());
    await advance(REFRESH_RETRY_MS * 2); // also what pins "clear the retry on unmount"
    expect(sent.length).toBe(n);
  });

  it('a run started meanwhile cancels the scheduled retry: the old timer does not fire', async () => {
    const { sent, advance, now } = await timedRefreshes((srv) => srv.down.add('/auth/refresh'));
    const n = sent.length;
    await advance(5_000);
    await act(async () => void (await now().syncNow())); // fails the same way, 5 s after the first failure
    expect(sent.length).toBe(n + 1);
    await advance(REFRESH_RETRY_MS - 5_001); // the first timer's moment (t = 20 s) is past: it must not fire
    expect(sent.length).toBe(n + 1);
    await advance(REFRESH_RETRY_MS - 5_000); // the manual run scheduled its own retry, 20 s after it (t = 25 s): one send, not two
    expect(sent.length).toBe(n + 2);
  });

  it('the retry timer does not run while a confirm dialog holds the schedule', async () => {
    const { sent, advance, now } = await timedRefreshes((srv) => srv.down.add('/auth/refresh'));
    const n = sent.length;
    await act(async () => now().holdSchedule(true));
    await advance(REFRESH_RETRY_MS);
    expect(sent.length).toBe(n);
  });

  it('a refresh that timed out is retried inside the 60 s grace window counted from its first send, once, not once per timer and tick', async () => {
    const gate = { srv: undefined as undefined | ReturnType<typeof setupServer> };
    const { sent, advance, expire } = await timedRefreshes((srv) => void (gate.srv = srv));
    expire.syncs = 2; // the run and its retry
    (gate.srv as ReturnType<typeof setupServer>).gate = new Promise<void>(() => undefined); // that refresh never answers: it ends at the timeout
    const n = sent.length;
    await advance(SYNC_INTERVAL_MS); // the next tick starts the run
    expect(sent.length).toBe(n + 1);
    await advance(REFRESH_TIMEOUT_MS + REFRESH_RETRY_MS + 5_000);
    expect(sent.length).toBe(n + 2);
    const gap = (sent[n + 1] ?? 0) - (sent[n] ?? 0);
    expect(gap).toBe(REFRESH_TIMEOUT_MS + REFRESH_RETRY_MS);
    expect(gap).toBeLessThan(60_000);
    expect(REFRESH_TIMEOUT_MS + REFRESH_RETRY_MS).toBeLessThanOrEqual(45_000); // keeps 15 s of margin under the window for clock and scheduling slack
  });

  it('back in the app (native foreground) ends the wait and starts from 30 s again', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    let onChange: ((s: string) => void) | undefined;
    const original = AppState.addEventListener;
    AppState.addEventListener = ((_t: string, h: (s: string) => void) => {
      onChange = h;
      return { remove: () => undefined };
    }) as never;
    try {
      const srv = setupServer();
      srv.s.online = false;
      const tokens = memoryTokens({ access: srv.s.accessValid, refresh: 'r' });
      const { sync } = await mountWith(tokens);
      const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
      await advance(0);
      await waitFor(() => expect(sync().signedIn).toBe(true));
      await advance(0);
      await advance(SYNC_INTERVAL_MS); // second failure: the wait is now 60 s
      const n = srv.calls('/sync');
      await advance(SYNC_INTERVAL_MS);
      expect(srv.calls('/sync')).toBe(n); // still waiting
      await act(async () => {
        onChange?.('background');
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(srv.calls('/sync')).toBe(n); // leaving the app does nothing
      await act(async () => {
        onChange?.('active');
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(srv.calls('/sync')).toBe(n + 1); // at once
      await advance(SYNC_INTERVAL_MS);
      expect(srv.calls('/sync')).toBe(n + 2); // and the next wait is 30 s, not 2 min
    } finally {
      AppState.addEventListener = original;
    }
  });

  it('a successful run resets the wait', async () => {
    setWeb();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const srv = setupServer();
    srv.s.online = false;
    const tokens = memoryTokens({ access: srv.s.accessValid, refresh: '' });
    const { sync } = await mount(tokens);
    const advance = async (ms: number) => void (await act(async () => void (await jest.advanceTimersByTimeAsync(ms))));
    await advance(0);
    await waitFor(() => expect(sync().signedIn).toBe(true));
    await advance(SYNC_INTERVAL_MS); // second failure: next wait is 60 s
    srv.s.online = true;
    await advance(2 * SYNC_INTERVAL_MS); // run at t = 90 s succeeds
    const after = srv.calls('/sync');
    expect(sync().last?.status).toBe('ok');
    await advance(SYNC_INTERVAL_MS);
    expect(srv.calls('/sync')).toBe(after + 1); // back to the 30 s schedule
  });
});
