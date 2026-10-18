import type { ApiClient } from '@plate-and-bar/api';
import { ACCESS_KEY, REFRESH_KEY } from '../secure/tokens';
import { REQUEST_TIMEOUT_MS, withTimeout } from './timeout';
import { trackCookieCall } from './cookieHealth';
import { authInit, cookieMode } from './transport';

// Web session bookkeeping for the cookie mode of ADR 006. Nothing here reads, stores or logs the refresh token, except
// `dropLegacyWebTokens`, which holds an old one in a local variable only long enough to revoke it.

/** The only thing the web app keeps in web storage: a flag with no token in it (allowed by the contract, `POST /auth/refresh/revoke`). */
const PENDING_KEY = 'pb.signout_pending';

function webStorages(): Storage[] {
  const out: Storage[] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const s = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
      if (s) out.push(s);
    } catch {
      // storage blocked by the browser
    }
  }
  return out;
}

/** Fallback for blocked storage: the flag then lives for this page only, which still covers an offline sign-out in this tab. */
let memoryPending = false;

/** True while a sign-out on this browser has not reached the server: the cookie would sign the user back in, so no refresh may run. */
export function signOutPending(): boolean {
  if (!cookieMode()) return false;
  if (memoryPending) return true;
  try {
    return globalThis.localStorage?.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSignOutPending(): void {
  if (!cookieMode()) return;
  try {
    if (!globalThis.localStorage) memoryPending = true; // no storage at all (some embedded webviews)
    globalThis.localStorage?.setItem(PENDING_KEY, '1');
  } catch {
    // Storage blocked: the flag then lives in this tab's memory only. Other tabs cannot read it, but they still hear the
    // BroadcastChannel message below and drop their access token; their next refresh would use the cookie again until this
    // tab's revoke clears it (it runs right after, under the same lock).
    memoryPending = true;
  }
  announceSignOut();
}

// Cross-tab sign-out (#762). All tabs share one cookie but each keeps its own access token in memory, so a sign-out (or any
// end of the session) in one tab must tell the others to drop theirs at once. BroadcastChannel carries it; where there is
// none, the `storage` event of the pending flag does (it fires in every other tab when the flag is written). The message
// holds no token and no user data.
const CHANNEL_NAME = 'pb-session';
const SIGNOUT_MESSAGE = 'signout';
const remoteListeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined; // undefined: not tried yet; null: not available
let storageHooked = false;

function tellListeners(): void {
  for (const f of [...remoteListeners]) {
    try {
      f();
    } catch {
      // one listener failing must not stop the others
    }
  }
}

function openChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = null;
  try {
    const C = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (C) {
      const c = new C(CHANNEL_NAME);
      c.addEventListener('message', (e: MessageEvent) => {
        if ((e.data as { type?: string } | null)?.type === SIGNOUT_MESSAGE) tellListeners();
      });
      (c as unknown as { unref?: () => void }).unref?.(); // Node (tests): an open channel must not keep the process alive
      channel = c;
    }
  } catch {
    channel = null;
  }
  return channel;
}

function announceSignOut(): void {
  try {
    openChannel()?.postMessage({ type: SIGNOUT_MESSAGE });
  } catch {
    // the storage event still reaches the other tabs when there is no channel
  }
}

/**
 * Calls `f` when another tab of this browser ends the session (not when this tab does). Returns the unsubscribe function.
 * Web only; a no-op elsewhere.
 */
export function onRemoteSignOut(f: () => void): () => void {
  remoteListeners.add(f);
  if (!openChannel() && !storageHooked) {
    storageHooked = true;
    (globalThis as { addEventListener?: (t: string, h: (e: { key?: string | null; newValue?: string | null }) => void) => void }).addEventListener?.('storage', (e) => {
      if (e.key === PENDING_KEY && e.newValue === '1') tellListeners();
    });
  }
  return () => void remoteListeners.delete(f);
}

export function clearSignOutPending(): void {
  memoryPending = false;
  try {
    globalThis.localStorage?.removeItem(PENDING_KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * Asks the server to end the session and clear the cookie. True when it answered 204 (the flag is cleared); false on a
 * failure, a 503 or no connection (the flag stays and the caller retries later). Never throws.
 */
export function revokeCookie(api: ApiClient): Promise<boolean> {
  // Under the cross-tab lock, so a revoke and a refresh never overlap in the browser's cookie jar.
  return cookieMode() ? withTabLock(() => postRevoke(api)) : Promise.resolve(true);
}

/** `revokeCookie` for a caller that already holds the tab lock (Web Locks are not reentrant). */
export async function postRevoke(api: ApiClient): Promise<boolean> {
  if (!cookieMode()) return true;
  try {
    const r = await withTimeout(REQUEST_TIMEOUT_MS, (signal) => trackCookieCall(api, () => api.POST('/auth/refresh/revoke', { body: {}, signal, ...authInit() })));
    if (r.timedOut || r.value.response.status !== 204) return false;
    clearSignOutPending();
    return true;
  } catch {
    return false;
  }
}

/**
 * Migration: removes a refresh (and access) token that an earlier web build left in web storage, then revokes that session
 * in body mode, best effort. The contract does not let it become a cookie session (a cookie is only set in cookie mode,
 * which refuses a body token), so this user is signed out once and signs in again.
 */
export async function dropLegacyWebTokens(api: ApiClient | null): Promise<void> {
  if (!cookieMode()) return;
  let legacy: string | null = null;
  for (const s of webStorages()) {
    try {
      legacy ??= s.getItem(REFRESH_KEY);
      s.removeItem(REFRESH_KEY);
      s.removeItem(ACCESS_KEY);
    } catch {
      // keep going with the other storage
    }
  }
  if (!legacy || !api) return;
  try {
    await withTimeout(REQUEST_TIMEOUT_MS, (signal) => api.POST('/auth/refresh/revoke', { body: { refresh_token: legacy }, signal }));
  } catch {
    // the old session expires on its own
  }
}

/**
 * Runs a refresh while holding a lock shared by every tab of this browser (Web Locks API), because all tabs share one
 * cookie: two racing refreshes could leave the browser with a replaced token, and the next refresh would end the session as
 * reuse (ADR 006). Without the API (an old browser) it just runs.
 */
export function withTabLock<T>(f: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request<R>(name: string, cb: () => Promise<R>): Promise<R> } } }).navigator?.locks;
  return locks ? locks.request('pb-refresh-cookie', f) : f();
}
