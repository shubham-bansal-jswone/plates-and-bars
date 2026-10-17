import type { ApiClient } from '@plate-and-bar/api';
import { ACCESS_KEY, REFRESH_KEY } from '../secure/tokens';
import { REQUEST_TIMEOUT_MS, withTimeout } from './timeout';
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
    memoryPending = true; // storage blocked
  }
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
    const r = await withTimeout(REQUEST_TIMEOUT_MS, (signal) => api.POST('/auth/refresh/revoke', { body: {}, signal, ...authInit() }));
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
