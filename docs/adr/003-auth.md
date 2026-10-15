# ADR 003: Auth (Google and email code sign-in, JWT with rotating refresh tokens)

- Status: Accepted
- Amended 2026-10-08: recorded the per-address code limits added with rate limiting (#43) and their lockout consequence. The per-code rule is unchanged.
- Amended 2026-10-15: lost-response grace window for refresh (#399).
- Date: 2026-10-08

## Context

The app is offline-first, so a user may open it on a gym floor with no signal long after their last sign-in, and losing a session must never lose data. The development plan fixes the sign-in methods (Google sign-in plus an email one-time code, Sign in with Apple when iOS ships) and asks for short-lived access tokens with refresh rotation and tokens kept in the phone's secure storage. The draft contract already implements the `/auth/*` endpoints; ADR 001's scope is fixed by the plan, so the auth decisions are recorded here (issue #6).

## Decision

- **Sign-in methods:** Google sign-in (`POST /auth/google`, the device sends a Google ID token that the backend verifies) and an emailed 6-digit one-time code (`POST /auth/email/start`, then `POST /auth/email/verify`). The first successful sign-in creates the account. Two methods mean email still works if Google sign-in fails.
- **Sign in with Apple is deferred to iOS (v1.1).** Apple requires it when other third-party sign-ins are offered on iOS, and Android and the web do not need it.
- **No account enumeration:** `/auth/email/start` always answers 202 for a well-formed address, whether or not an account exists, and is rate-limited per address and per IP.
- **Codes:** single-use, short expiry, invalidated after 5 wrong attempts; the user then requests a new code. Rate limiting (#43) adds per-address caps: codes issued per hour and per day, and wrong guesses counted across codes, so requesting a new code does not reset the guessing budget.
- **Access token:** a JWT valid for 15 minutes, sent as a bearer token.
- **Refresh token:** opaque, single-use, stored server-side (`refresh_tokens`) and on the device in secure storage. Lifetime 90 days, extended on rotation: each `POST /auth/refresh` invalidates the old token and returns a new one valid for 90 days from that refresh.
- **Reuse revokes the session:** presenting an already-rotated refresh token is treated as theft, and every token descended from the same sign-in is revoked; the user must sign in again.
- **Lost-response grace (#399):** a rotated token presented again less than 60 seconds after its first rotation, while the token it was exchanged for has never been presented to `/auth/refresh` (using its access token does not count), is treated as a retry of a lost response: the server rotates that unused token (marks it replaced, exactly as if it had been presented) and issues one new pair in the same session. The window is measured from the first rotation and is never extended by a retry. A second retry of the same old token inside the window replaces whichever successor is current, provided that successor has not been presented. The replaced token is dead and presenting it is reuse, so the session is revoked. Refresh tokens are stored only as hashes, so the first response cannot be replayed; a replacement is issued instead. After 60 seconds, or once the newer token was presented, reuse revokes the session as above. Rejected: a client-sent `refresh_id` (needs the response or token stored, and a request schema change).

## Consequences

- A user who opens the app at least once every 90 days stays signed in; an idle session ends after 90 days. Local data stays on the device and syncs after the same user signs in again; account linking and the account-switch rule are decided in ADR 004.
- A stolen access token is useful for at most 15 minutes.
- Two requests racing to refresh with the same token both succeed inside the grace window, but the request that loses the race holds a replaced token, and its next refresh ends the session as reuse, as it would today. The app must still serialise refreshes (one in flight at a time). A thief who presents a just-rotated token within the 60 s window gets a session, and the device's next refresh then presents the replaced token and ends the session.
- The backend must store a token family per sign-in to revoke it on reuse.
- Email sign-in depends on a mail provider and rate limits; the 202-always rule means the app cannot tell a user that an address has no account.
- The per-address caps let anyone lock a victim's address out of email-code sign-in by keeping its issuance or guess cap exhausted, and the victim receives up to the daily issuance limit of code emails. Per-IP limits do not prevent this: one source stays well within them while holding one address capped; they only limit how many addresses one source can hold. Devices already signed in are unaffected, and Google sign-in still works where the address is also a verified Google account. Accepted for M0, because the caps are what stop brute-force guessing. If abuse appears, the fix is per-(address, client) caps under a higher address-wide ceiling.
- Adding Sign in with Apple later is additive (a new sign-in endpoint and identity type) and needs its own contract PR.
