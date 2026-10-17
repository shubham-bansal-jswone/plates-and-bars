# ADR 006: Web refresh token in an httpOnly cookie, access token in memory

- Status: Accepted
- Amended 2026-10-18: recorded the web client follow-ups that landed after #742 (#777, #779) and what the misconfiguration check does and does not detect. No decision changed.
- Date: 2026-10-17
- Supersedes in part: [ADR 003](003-auth.md), only where the web app keeps the refresh token. Everything else in ADR 003 stands, and native apps are unchanged.
- Decided by Shubham on #250 (2026-10-17).

## Context

ADR 003 keeps both tokens in the phone's secure storage. A browser has no secure storage, so the v1 web build kept tokens in memory only and the user signed in again after every reload (#250). The other options were:
- the refresh token in IndexedDB or `localStorage`, which survives a reload but is readable by any script on the page, so one XSS bug would hand out a 90-day session;
- the refresh token in an httpOnly cookie, which script cannot read but which needs a cookie-based refresh, CORS credentials and CSRF protection.

## Decision

- **Web: access token in memory only.** Never `localStorage`, `sessionStorage`, IndexedDB or a script-readable cookie. A reload calls `POST /auth/refresh` to get a new one.
- **Web: refresh token in a cookie set by the backend:** `__Secure-pb_refresh`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth/refresh`, no `Domain` (host-only on the API host), `Max-Age` equal to the 90-day refresh lifetime. Sign-in and refresh set it, rotation replaces it, and a 401 from refresh or a sign-out clears it. Rotation, reuse detection and the 60-second lost-response grace from ADR 003 apply unchanged.
- **Native: unchanged.** The refresh token travels in the JSON body and stays in SecureStore.
- **One contract for both, selected by the client.** The web app sends `X-Auth-Transport: cookie` on sign-in, refresh and sign-out. Any other value is ignored, the same as no header. With the header, the token is only in the cookie and the body's `refresh_token` is the empty string. Without it, the server never reads or sets the cookie.
  - `TokenPair.refresh_token` stays a required string, so the generated client and the native code do not change. Making it optional would break existing type-checked callers; separate web endpoints would duplicate every sign-in endpoint.
- **New sign-out endpoint** `POST /auth/refresh/revoke`. It lives under the cookie path so the cookie reaches it. It revokes the session of the presented token and clears the cookie, because script cannot delete an httpOnly cookie. It always answers 204.
- **CSRF: three defences, all required in cookie mode.**
  - `SameSite=Strict`: the browser does not send the cookie on requests started from another site.
  - The custom header: forms and simple requests cannot send it, and a script on another origin must pass a CORS preflight.
  - An `Origin` that exactly matches a cookie-mode origin, else 403 `forbidden` with nothing read or changed. This also covers the sign-in endpoints, so a login CSRF cannot plant another account's session.
  - The cookie-mode origins are a server setting separate from the CORS allow-list, holding only the web app's own origins. Other browser callers of the API, such as the website's account-deletion page, can be on the same site as the API, so `SameSite=Strict` would still send them the cookie. They may be CORS origins but never cookie-mode origins.
- **CORS:** exact origins (never `*`). On `/auth/*`, responses to cookie-mode origins carry `Access-Control-Allow-Credentials: true` and `Vary: Origin`, and preflights allow the `X-Auth-Transport` header. Other endpoints and other origins stay bearer-only.

## Consequences

- An XSS bug can still act as the user while the page is open, because it can call refresh through the browser. It cannot carry the refresh token away, so the session it can use ends when the page closes or the user signs out.
- The web app and the API must be served from the same site (`https`, same registrable domain, such as `app.example.com` and `api.example.com`). Otherwise the browser treats the cookie as third-party and never sends it. A public-suffix host such as `*.github.io` or `*.pages.dev` is its own site, so it cannot host the web app. This is a deployment requirement on infra. Local web development needs HTTPS or a browser that treats `http://localhost` as a secure context.
- All tabs share one cookie, while each tab has its own in-memory access token. The web app must serialise refreshes across tabs (for example with the Web Locks API). Otherwise two racing refreshes can leave the browser holding a replaced token, and the next refresh ends the session as reuse (ADR 003).
- Sign-out on the web needs the network. If the revoke call fails, the app keeps a token-free "sign-out pending" flag and does not refresh until the call succeeds. Otherwise the cookie would sign the user back in on reload.
- Every web page load costs one refresh call, within the existing per-IP rate limits.
- A browser on an origin that is not allowed fails the CORS preflight and never sees the 403. `fetch` reports a network error. The web app must not mistake a persistent failure of this kind for being offline, and must not retry it in a loop.
- The backend change must ship before the web app sends the header. The current CORS configuration does not allow `X-Auth-Transport` or credentials, so the browser would block the request.

## Follow-ups that landed (2026-10-18)

Items deferred from the web client PR #742, and where they went:
- Security-review findings 6 (cross-tab sign-out), 7 (a refresh timeout released the tab lock; the refresh inside a sync run had no timeout) and 9 (`offline` not backed off): #762, done by #777.
- Telling a misconfigured cookie mode apart from being offline (the CORS preflight consequence above): #744, done by #779.

### #777: cross-tab sign-out, bounded refresh, offline backoff

- **Cross-tab sign-out.** A sign-out or discard, an account deletion, a refused sign-in, or another account's cookie posts a `signout` message on the `pb-session` BroadcastChannel; where there is no BroadcastChannel, the `storage` event of the `pb.signout_pending` flag does the same. The message carries no token. Other tabs drop their in-memory access token and show signed out; local data and the account binding stay. A refresh response that arrives after another tab signed out is not saved. A session the server ends (refresh answers 401) is not broadcast: each other tab finds out on its own next refresh.
- **Refresh timeout under the tab lock.** Each `/auth/refresh` request has its own timeout (`REFRESH_TIMEOUT_MS`, 20 s), started inside the tab lock, so the lock is held until the request settles or the timeout fires. The refresh inside a sync run, which had no timeout, is bounded too. A timeout is `unavailable`, never a sign-out.
- **Retries and the 60 s grace window.** The 20 s timeout is under the server's 60 s lost-response grace window (ADR 003), so a tab that presents the same cookie after a given-up request is not read as reuse. A sync run that fails on the refresh request itself with an ambiguous outcome (no connection, a timeout or a 5xx) is retried by its own timer 20 s after the failure, so the retry goes out at most 40 s after the first send (20 s timeout plus 20 s), inside the window and with 15 s to spare for clock and scheduling slack. A definite refusal (a 4xx such as the Origin 403 above) rotated nothing and follows the normal schedule. The fast retry is used once: if it fails too, the window can no longer be counted on, so the run falls back to the normal offline and unavailable backoff below instead of retrying every 20 s while a phone stays offline. An `online` or foreground event cancels the timer, resets the backoff and starts a run at once. If a retry still lands outside the window (the server rotated, then the retry arrived after 60 s), the server reads it as reuse and ends the session (ADR 003); local data stays. Implemented in #813, closing #809.
- **Offline backoff.** `offline` backs off like `unavailable`: the wait doubles from 30 s up to a 5-minute cap. The browser's `online` event and the app coming back to the foreground reset it to 30 s.

### #779: misconfigured cookie mode is not "offline"

Every cookie-mode call (`/auth/refresh`, `/auth/refresh/revoke`, `/auth/email/verify`) is counted. After 3 network-level failures in a row, the app asks `GET /health` once, with no credentials and no `X-Auth-Transport`. If that answers 200, the app shows "Sign-in isn't available on this site" instead of offline, and stops retrying the cookie-mode calls on its own. User-started cookie-mode calls (code check, export, delete) are still attempted. The flag clears when a cookie-mode call gets an answer (a user-started call, a user-pressed Sync now, or the one attempt let through every 10 minutes), on the browser's `online` event, or on a page reload.

What it detects, and what it does not (from #779; the header comment of `apps/mobile/src/sync/cookieHealth.ts` gives the same lists):
- Detects: the API answers a plain cross-origin `GET /health` from this page (so CORS allows the origin) while the credentialed cookie-mode calls fail at the network level (the origin is not in the backend's cookie-mode origin list, so the preflight for `X-Auth-Transport` is refused).
- Does not detect: an origin missing from CORS altogether (`/health` fails too, so it reads as offline); an API that is down; a cookie the browser stores but never sends (cross-site or http deployment: the calls get answers and refresh says 401, like a signed-out user); a proxy that drops only some requests.
