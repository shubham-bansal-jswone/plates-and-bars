import type { ApiClient } from '@plate-and-bar/api';
import { withTimeout } from './timeout';
import { cookieMode } from './transport';

// Web only (ADR 006, #744). A browser on an origin the backend does not list for cookie mode fails the CORS preflight of the
// cookie-mode calls (`/auth/refresh`, `/auth/refresh/revoke`, `/auth/email/verify`): `fetch` reports a network error, which
// looks like being offline. The tell is that those calls keep failing at the network level while a plain call to the same API,
// `GET /health` (no credentials; it may carry `Authorization` when an access token is in memory; an origin the web CSP's connect-src already allows), gets an answer. Then
// the site is misconfigured, and the app says so instead of "offline" and stops retrying on its own. Nothing here logs or
// keeps a token, an address or a user value.
//
// What it detects: the API answers a plain cross-origin GET from this page (so CORS allows this origin) but not the credentialed
// cookie-mode calls (the origin is not in the backend's cookie-mode origin list, so the preflight for `X-Auth-Transport` is
// refused). What it does not: an origin missing from CORS altogether (`/health` fails too, so it reads as offline); an API that
// is down; a cookie the browser stores but never sends (cross-site or http deployment: the calls get answers, and refresh says
// 401 like a signed-out user); a proxy that drops only some requests.

/** Consecutive network failures of cookie-mode calls before `/health` is asked. */
export const COOKIE_FAILURES_BEFORE_PROBE = 3;
/** How long the `/health` probe may take. */
export const PROBE_TIMEOUT_MS = 10_000;

let failures = 0;
let flagged = false;
let probing: Promise<void> | null = null;
let attempt = false;
const listeners = new Set<(unavailable: boolean) => void>();

function setFlag(v: boolean): void {
  if (flagged === v) return;
  flagged = v;
  for (const f of [...listeners]) f(v);
}

/** True once cookie-mode calls were found to fail while the API itself answers: sign-in cannot work from this site. */
export const signInUnavailable = (): boolean => flagged;

/** Calls `f` when the flag changes (with the new value). Returns the unsubscribe function. */
export function onSignInUnavailable(f: (unavailable: boolean) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** A cookie-mode call got an HTTP answer, whatever its status: the browser let it through, so the site works. */
function answered(): void {
  failures = 0;
  setFlag(false);
}

/** Counts one network-level failure; after `COOKIE_FAILURES_BEFORE_PROBE` in a row asks `/health` once. */
function failed(api: ApiClient): void {
  if (flagged || probing) return;
  if (++failures < COOKIE_FAILURES_BEFORE_PROBE) return;
  probing = (async () => {
    try {
      const r = await withTimeout(PROBE_TIMEOUT_MS, (signal) => api.GET('/health', { signal, cache: 'no-store' }));
      if (!r.timedOut && r.value.response.ok) setFlag(true);
    } catch {
      // the API does not answer either: this really is no connection
    } finally {
      failures = 0; // a probe that found the network down starts the count again
      probing = null;
    }
  })();
}

/** Resolves when the probe started by a failure (if any) is done. For a caller that is about to show the result. */
export const probeSettled = (): Promise<void> => probing ?? Promise.resolve();

/** A `fetch` that rejected before any answer (a CORS or connection failure), not a timeout abort or a bad body. */
const isNetworkFailure = (e: unknown): boolean => e instanceof TypeError;

/**
 * Runs one cookie-mode request and keeps the count. An answer clears the flag; a network failure counts toward it. Does not wait
 * for the probe (the caller may hold the tab lock): use `probeSettled` where the result is shown. A no-op off the web.
 */
export async function trackCookieCall<T>(api: ApiClient, call: () => Promise<T>): Promise<T> {
  if (!cookieMode()) return call();
  try {
    const r = await call();
    answered();
    return r;
  } catch (e) {
    if (isNetworkFailure(e)) failed(api);
    throw e;
  }
}

/**
 * Lets the next automatic refresh or revoke go out once although the flag is set (a user pressed Sync now, the browser came back
 * online, or the periodic re-check is due). If it is answered the flag clears; if it fails the flag stays and nothing more is
 * counted. A no-op while not flagged.
 */
export function allowOneAttempt(): void {
  attempt = flagged;
}
/** True once per `allowOneAttempt`: the caller may send one request now. */
export function takeAttempt(): boolean {
  const a = attempt;
  attempt = false;
  return a;
}
/** Withdraws an attempt nobody used (a manual run that needed no refresh). */
export function cancelAttempt(): void {
  attempt = false;
}

/** The browser reports it is online again: forget what was learned while it was not (the cause may have been the network). */
export function clearSignInUnavailable(): void {
  failures = 0;
  attempt = false;
  setFlag(false);
}

/** Forgets everything (a test, or a new page). */
export function resetCookieHealth(): void {
  failures = 0;
  flagged = false;
  attempt = false;
  probing = null;
}
