# ADR 006: Web refresh token in an httpOnly cookie, access token in memory

- Status: Accepted
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
- **One contract for both, selected by the client.** The web app sends `X-Auth-Transport: cookie` on sign-in, refresh and sign-out. With the header, the token is only in the cookie and the body's `refresh_token` is the empty string. Without it, the server never reads or sets the cookie.
  - `TokenPair.refresh_token` stays a required string, so the generated client and the native code do not change. Making it optional would break existing type-checked callers; separate web endpoints would duplicate every sign-in endpoint.
- **New sign-out endpoint** `POST /auth/refresh/revoke`. It lives under the cookie path so the cookie reaches it. It revokes the session of the presented token and clears the cookie, because script cannot delete an httpOnly cookie. It always answers 204.
- **CSRF: three defences, all required in cookie mode.**
  - `SameSite=Strict`: the browser does not send the cookie on requests started from another site.
  - The custom header: forms and simple requests cannot send it, and a script on another origin must pass a CORS preflight.
  - An `Origin` that exactly matches a configured web app origin, else 403 `forbidden` with nothing read or changed. This also covers the sign-in endpoints, so a login CSRF cannot plant another account's session.
- **CORS:** exact allowed origins (never `*`). On `/auth/*`, responses carry `Access-Control-Allow-Credentials: true` and `Vary: Origin`, and preflights allow the `X-Auth-Transport` header. Other endpoints stay bearer-only.

## Consequences

- An XSS bug can still act as the user while the page is open, because it can call refresh through the browser. It cannot carry the refresh token away, so the session it can use ends when the page closes or the user signs out.
- The web app and the API must be served from the same site (`https`, same registrable domain, such as `app.example.com` and `api.example.com`). Otherwise the browser treats the cookie as third-party and never sends it. This is a deployment requirement on infra. Local web development needs HTTPS or a browser that treats `http://localhost` as a secure context.
- All tabs share one cookie, while each tab has its own in-memory access token. The web app must serialise refreshes across tabs (for example with the Web Locks API). Otherwise two racing refreshes can leave the browser holding a replaced token, and the next refresh ends the session as reuse (ADR 003).
- Sign-out on the web needs the network. If the revoke call fails, the app keeps a token-free "sign-out pending" flag and does not refresh until the call succeeds. Otherwise the cookie would sign the user back in on reload.
- Every web page load costs one refresh call, within the existing per-IP rate limits.
- The backend change must ship before the web app sends the header. The current CORS configuration does not allow `X-Auth-Transport` or credentials, so the browser would block the request.
