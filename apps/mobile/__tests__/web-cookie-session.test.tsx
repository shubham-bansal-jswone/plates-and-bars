import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { createClient } from '@plate-and-bar/api';
import { startEmailSignIn, verifyEmailCode } from '../src/sync/auth';
import { syncOnce } from '../src/sync/engine';
import { signOut } from '../src/sync/guard';
import { KEY_USER, getUserId, setKv } from '../src/sync/store';
import { SyncProvider, useSync } from '../src/sync/SyncProvider';
import { webTokenStore } from '../src/sync/tokens';
import { clearSignOutPending, markSignOutPending, revokeCookie, signOutPending } from '../src/sync/webSession';
import { saveWeightDoc } from './sync-fixtures';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => null }));

// ADR 006 / issue #250: web keeps the access token in memory and the refresh token in an httpOnly cookie; native is unchanged.

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const API = 'http://fake/api/v1';
/** A refresh token the fake server hands out even in cookie mode (the real one sends ''): any copy of it in storage is a leak. */
const LEAK = 'LEAKED-refresh-token';

interface Logged { path: string; transport: string | null; credentials: string; body: Record<string, unknown>; auth: string | null }

/** fakeServer plus the cookie-mode contract: logs how each request was made and answers refresh and revoke like the backend. */
function setupServer() {
  const s = fakeServer(USER);
  const log: Logged[] = [];
  const w = {
    s,
    log,
    cookie: true,
    refreshStatus: null as number | null,
    revokeStatus: 204,
    networkDownFor: null as string | null,
    /** The account the cookie refresh and verify answer for. */
    refreshUser: USER,
    calls: (path: string) => log.filter((l) => l.path === path),
    fetch: async (input: Request): Promise<Response> => {
      const path = new URL(input.url).pathname.replace('/api/v1', '');
      const text = await input.clone().text();
      const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      const transport = input.headers.get('X-Auth-Transport');
      log.push({ path, transport, credentials: input.credentials, body, auth: input.headers.get('Authorization') });
      const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (w.networkDownFor === path) throw new TypeError('network down');
      if (path === '/me' && input.method === 'DELETE') return new Response(null, { status: 204 });
      if (path === '/auth/refresh/revoke') return w.revokeStatus === 204 ? new Response(null, { status: 204 }) : json(w.revokeStatus, { code: 'unavailable', message: 'x' });
      if (path === '/auth/refresh') {
        if (w.refreshStatus) return json(w.refreshStatus, { code: w.refreshStatus === 503 ? 'unavailable' : 'unauthorized', message: 'x' });
        const cookieMode = transport === 'cookie';
        if (cookieMode ? !w.cookie || 'refresh_token' in body : !body.refresh_token) return json(cookieMode && 'refresh_token' in body ? 400 : 401, { code: 'unauthorized', message: 'x' });
        s.refreshes++;
        s.accessValid = `access-cookie-${s.refreshes}`;
        return json(200, { token_type: 'Bearer', access_token: s.accessValid, access_token_expires_at: '2026-10-09T00:00:00Z', refresh_token: cookieMode ? LEAK : 'native-rotated', refresh_token_expires_at: '2027-01-01T00:00:00Z', user: { id: w.refreshUser, email: null, created_at: '2026-10-01T00:00:00Z' }, new_user: false });
      }
      return s.fetch(input);
    },
  };
  (globalThis as { fetch: unknown }).fetch = w.fetch;
  return w;
}

/** A browser's local and session storage that remembers every write. */
class FakeStorage {
  data = new Map<string, string>();
  writes: [string, string][] = [];
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => {
    this.writes.push([k, v]);
    this.data.set(k, v);
  };
  removeItem = (k: string) => void this.data.delete(k);
}
let local: FakeStorage;
let session: FakeStorage;
let platform: jest.ReplaceProperty<string> | null = null;
const setPlatform = (os: 'web' | 'ios') => {
  platform?.restore();
  platform = jest.replaceProperty(Platform, 'OS', os);
};
beforeEach(() => {
  local = new FakeStorage();
  session = new FakeStorage();
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });
  // The web build listens for 'online' on window; the test environment's window has no event methods.
  const win = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (win && typeof win.addEventListener !== 'function') Object.assign(win, { addEventListener: () => undefined, removeEventListener: () => undefined });
});
afterEach(() => {
  platform?.restore();
  platform = null;
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

describe('web: cold reload restores the session from the cookie', () => {
  it('calls refresh with the cookie header, credentials and an empty body, then syncs with the new access token', async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    const tokens = webTokenStore(); // a fresh page: nothing in memory
    const r = await syncOnce({ db, api: clientFor(tokens), tokens });
    expect(r.status).toBe('ok');
    const refresh = srv.calls('/auth/refresh');
    expect(refresh).toHaveLength(1);
    expect(refresh[0]).toMatchObject({ transport: 'cookie', credentials: 'include', body: {}, auth: null });
    const sync = srv.calls('/sync')[0]!;
    expect(sync.auth).toBe('Bearer access-cookie-1');
    // credentials only go to the auth endpoints that need the cookie
    expect(sync.transport).toBeNull();
    expect(sync.credentials).not.toBe('include');
    expect((await tokens.load())?.refresh).toBe('');
  });

  it('a 401 from refresh means signed out: no data request, tokens gone', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.cookie = false;
    const db = await setupDb();
    const tokens = webTokenStore();
    const r = await syncOnce({ db, api: clientFor(tokens), tokens });
    expect(r.status).toBe('signed_out');
    expect(srv.calls('/sync')).toHaveLength(0);
    expect(await tokens.load()).toBeNull();
  });

  it('a 503 from refresh keeps the session (not signed out) and the next run retries and succeeds', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.refreshStatus = 503;
    const db = await setupDb();
    const tokens = webTokenStore();
    const deps = { db, api: clientFor(tokens), tokens };
    expect((await syncOnce(deps)).status).toBe('unavailable');
    srv.refreshStatus = null;
    expect((await syncOnce(deps)).status).toBe('ok');
    expect(srv.calls('/auth/refresh')).toHaveLength(2);
  });

  it('takes the cross-tab lock around the cookie refresh', async () => {
    setPlatform('web');
    setupServer();
    const held: string[] = [];
    const nav = globalThis.navigator as unknown as { locks?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, 'locks');
    Object.defineProperty(nav, 'locks', { configurable: true, value: { request: async (name: string, cb: () => Promise<unknown>) => (held.push(name), cb()) } });
    try {
      const db = await setupDb();
      const tokens = webTokenStore();
      expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('ok');
      expect(held).toEqual(['pb-refresh-cookie']);
    } finally {
      if (had) Object.defineProperty(nav, 'locks', had);
      else delete nav.locks;
    }
  });

  it('while a sign-out is pending no refresh is sent: the run is signed out', async () => {
    setPlatform('web');
    const srv = setupServer();
    local.data.set('pb.signout_pending', '1');
    const db = await setupDb();
    const tokens = webTokenStore();
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('signed_out');
    expect(srv.log).toHaveLength(0);
  });

  it('no connection on refresh is offline, not signed out', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.networkDownFor = '/auth/refresh';
    const db = await setupDb();
    const tokens = webTokenStore();
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('offline');
  });

  it('refreshes mid-session on a 401 from the data call, again in cookie mode with an empty body', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.s.accessValid = 'newer';
    const db = await setupDb();
    const tokens = webTokenStore();
    await tokens.save({ access: 'access-old', refresh: '' });
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('ok');
    expect(srv.calls('/auth/refresh')[0]).toMatchObject({ transport: 'cookie', credentials: 'include', body: {} });
  });
});

describe('native: body mode is unchanged', () => {
  it('refresh sends the stored token in the body, with no cookie header and no credentials', async () => {
    setPlatform('ios');
    const srv = setupServer();
    srv.s.accessValid = 'newer';
    const db = await setupDb();
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('ok');
    const refresh = srv.calls('/auth/refresh')[0]!;
    expect(refresh.body).toEqual({ refresh_token: 'refresh-1' });
    expect(refresh.transport).toBeNull();
    expect(refresh.credentials).not.toBe('include');
    expect(tokens.current?.refresh).toBe('native-rotated');
  });

  it('with no tokens a run is signed out and calls nothing (no cookie restore on native)', async () => {
    setPlatform('ios');
    const srv = setupServer();
    const db = await setupDb();
    const tokens = memoryTokens(null);
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('signed_out');
    expect(srv.log).toHaveLength(0);
  });

  it('email sign-in sends no cookie header; sign-out leaves web storage alone and calls no revoke', async () => {
    setPlatform('ios');
    const srv = setupServer();
    const db = await openDb();
    const tokens = memoryTokens(null);
    const api = clientFor(tokens);
    expect((await verifyEmailCode(db, api, tokens, 'a@example.com', '123456')).kind).toBe('signed_in');
    const verify = srv.calls('/auth/email/verify')[0]!;
    expect(verify.transport).toBeNull();
    expect(verify.credentials).not.toBe('include');
    expect(tokens.current?.refresh).toBe('refresh-verified'); // native keeps it (SecureStore in the app)
    await signOut(db, tokens);
    expect(local.writes).toEqual([]);
    expect(signOutPending()).toBe(false);
  });
});

describe('web: tokens and web storage', () => {
  it('the refresh token is never written to web storage or kept in memory; only a token-free flag is stored', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.s.accessValid = 'newer';
    const db = await openDb();
    const tokens = webTokenStore();
    const api = clientFor(tokens);
    await startEmailSignIn(api, 'a@example.com');
    expect((await verifyEmailCode(db, api, tokens, 'a@example.com', '123456')).kind).toBe('signed_in'); // server answers refresh-verified
    expect(srv.calls('/auth/email/verify')[0]).toMatchObject({ transport: 'cookie', credentials: 'include' });
    // the access token is rejected: a cookie refresh answers with a body that (wrongly) carries a token
    srv.s.accessValid = 'newer';
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    await syncOnce({ db, api, tokens });
    await signOut(db, tokens);
    expect(srv.calls('/auth/refresh').length).toBeGreaterThan(0);
    const everything = JSON.stringify([...local.writes, ...session.writes, [...local.data], [...session.data]]);
    for (const secret of [LEAK, 'refresh-verified', 'access-verified', 'access-cookie']) expect(everything).not.toContain(secret);
    expect(session.writes).toEqual([]);
    expect(local.writes.every(([k, v]) => k === 'pb.signout_pending' && v === '1')).toBe(true);
    expect(await tokens.load()).toBeNull();
  });

  it('the store drops a refresh token it is handed and returns an empty one', async () => {
    const store = webTokenStore();
    await store.save({ access: 'a', refresh: 'should-not-stay' });
    expect(await store.load()).toEqual({ access: 'a', refresh: '' });
  });

  it('the email-start request carries neither the cookie header nor credentials', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.s.accessValid = 'x';
    await startEmailSignIn(clientFor(webTokenStore()), 'a@example.com').catch(() => undefined);
    const start = srv.calls('/auth/email/start')[0]!;
    expect(start.transport).toBeNull();
    expect(start.credentials).not.toBe('include');
  });
});

describe('the platform picks the token store', () => {
  afterEach(() => {
    jest.dontMock('react-native');
    jest.dontMock('expo-secure-store');
    jest.resetModules();
  });
  const load = (os: string) => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    jest.doMock('expo-secure-store', () => ({ setItemAsync: jest.fn(), getItemAsync: jest.fn(async () => null), deleteItemAsync: jest.fn() }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import is unsupported in Jest CJS
    return (require('../src/sync/tokens') as typeof import('../src/sync/tokens')).secureTokens;
  };

  it('web: the access token is kept in memory and the refresh token is dropped', async () => {
    const web = load('web');
    await web.save({ access: 'a', refresh: 'r' });
    expect(await web.load()).toEqual({ access: 'a', refresh: '' });
  });

  it('native: SecureStore keeps both (the mocked store here holds nothing, so load is null)', async () => {
    const native = load('ios');
    await native.save({ access: 'a', refresh: 'r' });
    expect(await native.load()).toBeNull();
  });
});

async function mount(db: Awaited<ReturnType<typeof openDb>>, tokens: ReturnType<typeof webTokenStore>) {
  let latest!: ReturnType<typeof useSync>;
  const Grab = () => {
    latest = useSync();
    return null;
  };
  const ui = await render(
    <SyncProvider db={db} tokens={tokens} api={clientFor(tokens)}>
      <Grab />
    </SyncProvider>,
  );
  return { ui, sync: () => latest };
}

describe('web provider', () => {
  it('cold reload: signed in after the cookie refresh', async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(sync().signedIn).toBe(true));
    expect(srv.calls('/auth/refresh')[0]).toMatchObject({ transport: 'cookie', credentials: 'include' });
  });

  it('cold reload with a 401: signed out, local data and binding kept', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.cookie = false;
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(srv.calls('/auth/refresh').length).toBe(1));
    await waitFor(() => expect(sync().linked).toBe(true));
    expect(sync().signedIn).toBe(false);
  });

  it('cold reload with a 503: stays signed in and retries on the next sync run', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.refreshStatus = 503;
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(sync().signedIn).toBe(true));
    await waitFor(() => expect(sync().last?.status).toBe('unavailable'));
    srv.refreshStatus = null;
    await act(async () => void (await sync().syncNow()));
    await waitFor(() => expect(sync().last?.status).toBe('ok'));
  });

  it('sign-out calls revoke (cookie header, credentials, empty body) and clears the pending flag on 204', async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(sync().signedIn).toBe(true));
    await act(async () => void (await sync().signOut()));
    await waitFor(() => expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1));
    expect(srv.calls('/auth/refresh/revoke')[0]).toMatchObject({ transport: 'cookie', credentials: 'include', body: {} });
    await waitFor(() => expect(signOutPending()).toBe(false));
    expect(sync().signedIn).toBe(false);
  });

  it('a failed revoke keeps the pending flag, and a reload then does not call refresh', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.revokeStatus = 503;
    const db = await setupDb();
    const first = await mount(db, webTokenStore());
    await waitFor(() => expect(first.sync().signedIn).toBe(true));
    await act(async () => void (await first.sync().signOut()));
    await waitFor(() => expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1));
    expect(signOutPending()).toBe(true);
    await cleanup();
    const refreshesBefore = srv.calls('/auth/refresh').length;
    const second = await mount(db, webTokenStore()); // a reload: the cookie would sign the user back in
    await waitFor(() => expect(srv.calls('/auth/refresh/revoke').length).toBe(2)); // retried first
    srv.revokeStatus = 204;
    expect(srv.calls('/auth/refresh')).toHaveLength(refreshesBefore);
    expect(second.sync().signedIn).toBe(false);
  });

  it('migration: a refresh token left in web storage is removed, revoked in body mode, and the user is signed out cleanly', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.cookie = false;
    local.data.set('pb.refresh_token', 'legacy-rt');
    local.data.set('pb.access_token', 'legacy-at');
    session.data.set('pb.refresh_token', 'legacy-rt');
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1));
    expect(local.data.size).toBe(0);
    expect(session.data.size).toBe(0);
    expect(srv.calls('/auth/refresh/revoke')[0]).toMatchObject({ transport: null, body: { refresh_token: 'legacy-rt' } });
    await waitFor(() => expect(sync().linked).toBe(true));
    expect(sync().signedIn).toBe(false);
  });
});

const OTHER = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const bearers = (srv: ReturnType<typeof setupServer>) => srv.calls('/sync').map((c) => c.auth);

describe('web: a cookie for another account never carries this store (ADR 004)', () => {
  it('cold reload: refresh answers another user: no /sync, tokens cleared, signed out, cookie revoked', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.refreshUser = OTHER;
    const db = await setupDb();
    const tokens = webTokenStore();
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('signed_out');
    expect(srv.calls('/sync')).toHaveLength(0);
    expect(await tokens.load()).toBeNull();
    expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1);
    expect(srv.calls('/auth/refresh/revoke')[0]).toMatchObject({ transport: 'cookie', credentials: 'include', body: {} });
  });

  it('mid-run 401 then a refresh for another user: the other account token is never sent to /sync', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.refreshUser = OTHER;
    srv.s.accessValid = 'newer';
    const db = await setupDb();
    const tokens = webTokenStore();
    await tokens.save({ access: 'access-old', refresh: '' });
    expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('signed_out');
    expect(bearers(srv)).toEqual(['Bearer access-old']);
    expect(await tokens.load()).toBeNull();
    expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1);
  });

  it('a failed revoke leaves the pending flag, so the other cookie is not refreshed again', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.refreshUser = OTHER;
    srv.revokeStatus = 503;
    const db = await setupDb();
    const tokens = webTokenStore();
    const deps = { db, api: clientFor(tokens), tokens };
    await syncOnce(deps);
    expect(signOutPending()).toBe(true);
    await syncOnce(deps);
    expect(srv.calls('/auth/refresh')).toHaveLength(1);
  });

  it('provider cold reload with the mismatch: signed out, binding and data kept', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.refreshUser = OTHER;
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(srv.calls('/auth/refresh').length).toBe(1));
    await waitFor(() => expect(sync().linked).toBe(true));
    expect(sync().signedIn).toBe(false);
    expect(await getUserId(db)).toBe(USER);
    expect(srv.calls('/sync')).toHaveLength(0);
  });
});

describe('web: every end of a session revokes the cookie', () => {
  const expectRevoke = (srv: ReturnType<typeof setupServer>) => {
    expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1);
    expect(srv.calls('/auth/refresh/revoke')[0]).toMatchObject({ transport: 'cookie', credentials: 'include', body: {} });
  };

  it('verify refused (another account on this device): flag set, revoke sent', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.revokeStatus = 503; // keeps the flag visible
    const db = await setupDb();
    await saveWeightDoc(db, { id: null, version: 0, updated_at: '2026-10-09T06:00:00Z', deleted_at: null, date: '2026-10-08', weight_kg: 80 });
    await setKv(db, KEY_USER, OTHER); // the store belongs to someone else with unsynced changes; verify answers USER
    const tokens = webTokenStore();
    const r = await verifyEmailCode(db, clientFor(tokens), tokens, 'a@example.com', '123456');
    expect(r.kind).toBe('refused');
    await waitFor(() => expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1));
    expect(local.data.get('pb.signout_pending')).toBe('1');
    expectRevoke(srv);
  });

  it('verify where saving the tokens throws after the cookie was set: offline result, but the cookie is revoked', async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await openDb();
    const tokens = webTokenStore();
    tokens.save = async () => {
      throw new Error('disk');
    };
    const r = await verifyEmailCode(db, clientFor(tokens), tokens, 'a@example.com', '123456');
    expect(r).toMatchObject({ kind: 'error' });
    await waitFor(() => expectRevoke(srv));
  });

  it('delete account (204): the cookie is revoked', async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    const tokens = webTokenStore();
    await tokens.save({ access: srv.s.accessValid, refresh: '' });
    const { sync } = await mount(db, tokens);
    await waitFor(() => expect(sync().signedIn).toBe(true));
    await act(async () => {
      expect(await sync().deleteEverything()).toMatchObject({ kind: 'deleted', server: true });
    });
    await waitFor(() => expectRevoke(srv));
  });

  it('discard and sign out: flag set, revoke sent', async () => {
    setPlatform('web');
    const srv = setupServer();
    srv.revokeStatus = 503;
    const db = await setupDb();
    const { sync } = await mount(db, webTokenStore());
    await waitFor(() => expect(sync().signedIn).toBe(true));
    await act(async () => void (await sync().discardAndSignOut()));
    await waitFor(() => expect(srv.calls('/auth/refresh/revoke')).toHaveLength(1));
    expect(local.data.get('pb.signout_pending')).toBe('1');
    expect(srv.calls('/auth/refresh/revoke')[0]).toMatchObject({ transport: 'cookie', credentials: 'include' });
  });
});

describe('web: tab lock and storage edge cases', () => {
  const withLocks = async (request: (name: string, cb: () => Promise<unknown>) => Promise<unknown>, f: () => Promise<void>) => {
    const nav = globalThis.navigator as unknown as { locks?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, 'locks');
    Object.defineProperty(nav, 'locks', { configurable: true, value: { request } });
    try {
      await f();
    } finally {
      if (had) Object.defineProperty(nav, 'locks', had);
      else delete nav.locks;
    }
  };

  it('a sign-out in another tab while this one waits for the lock: no refresh is sent', async () => {
    setPlatform('web');
    const srv = setupServer();
    const db = await setupDb();
    const tokens = webTokenStore();
    await withLocks(
      async (_n, cb) => {
        local.data.set('pb.signout_pending', '1'); // the other tab signed out (and its revoke failed) while we waited
        return cb();
      },
      async () => {
        expect((await syncOnce({ db, api: clientFor(tokens), tokens })).status).toBe('signed_out');
      },
    );
    expect(srv.calls('/auth/refresh')).toHaveLength(0);
  });

  it('the revoke runs under the same cross-tab lock', async () => {
    setPlatform('web');
    setupServer();
    const held: string[] = [];
    await withLocks(
      async (name, cb) => (held.push(name), cb()),
      async () => {
        expect(await revokeCookie(clientFor(webTokenStore()))).toBe(true);
      },
    );
    expect(held).toEqual(['pb-refresh-cookie']);
  });

  it('blocked localStorage: the sign-out flag still holds for this page', () => {
    setPlatform('web');
    local.setItem = () => {
      throw new Error('blocked');
    };
    markSignOutPending();
    expect(signOutPending()).toBe(true);
    clearSignOutPending();
    expect(signOutPending()).toBe(false);
  });
});
