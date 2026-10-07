# ADR 003: Auth (Google and email code sign-in, JWT with rotating refresh tokens)

- Status: Accepted
- Date: 2026-10-08
- Amended 2026-10-08: recorded two omissions decided on #17: one account per verified email across sign-in methods, and the rule for unsynced records when a different account signs in on the same device.

## Context

The app is offline-first, so a user may open it on a gym floor with no signal long after their last sign-in, and losing a session must never lose data. The development plan fixes the sign-in methods (Google sign-in plus an email one-time code, Sign in with Apple when iOS ships) and asks for short-lived access tokens with refresh rotation and tokens kept in the phone's secure storage. The draft contract already implements the `/auth/*` endpoints; ADR 001's scope is fixed by the plan, so the auth decisions are recorded here (issue #6).

## Decision

- **Sign-in methods:** Google sign-in (`POST /auth/google`, the device sends a Google ID token that the backend verifies) and an emailed 6-digit one-time code (`POST /auth/email/start`, then `POST /auth/email/verify`). The first successful sign-in creates the account. Two methods mean email still works if Google sign-in fails.
- **One account per verified email:** a Google sign-in whose ID token carries `email_verified: true` and an email-code sign-in for the same address reach the same account; the backend links both identities in `auth_identities`. A Google token without a verified email is refused rather than linked.
- **Sign in with Apple is deferred to iOS (v1.1).** Apple requires it when other third-party sign-ins are offered on iOS, and Android and the web do not need it.
- **No account enumeration:** `/auth/email/start` always answers 202 for a well-formed address, whether or not an account exists, and is rate-limited per address and per IP.
- **Codes:** single-use, short expiry, invalidated after 5 wrong attempts; the user then requests a new code.
- **Access token:** a JWT valid for 15 minutes, sent as a bearer token.
- **Refresh token:** opaque, single-use, stored server-side (`refresh_tokens`) and on the device in secure storage. Lifetime 90 days, extended on rotation: each `POST /auth/refresh` invalidates the old token and returns a new one valid for 90 days from that refresh.
- **Reuse revokes the session:** presenting an already-rotated refresh token is treated as theft, and every token descended from the same sign-in is revoked; the user must sign in again.
- **Unsynced records belong to the signed-in user only:** the local store is tied to one user id. While unsynced changes exist, the app does not allow signing out or signing in as another account; it offers "sync now" and "discard and sign out". After a session expires, only the same user may sign back in to push the queue; a different user is refused until the queue is synced or explicitly discarded. The server enforces the same boundary because `user_id` always comes from the token, never from the payload.

## Consequences

- A user who opens the app at least once every 90 days stays signed in; an idle session ends after 90 days. Local data stays on the device and syncs after the same user signs in again; another account cannot sign in over an unsynced queue (see Decision, #17).
- A stolen access token is useful for at most 15 minutes.
- Two requests racing to refresh with the same token look like reuse and end the session, so the app must serialise refreshes (one in flight at a time).
- The backend must store a token family per sign-in to revoke it on reuse.
- Email sign-in depends on a mail provider and rate limits; the 202-always rule means the app cannot tell a user that an address has no account.
- Adding Sign in with Apple later is additive (a new sign-in endpoint and identity type) and needs its own contract PR.
- If a user changes the email on their Google account, the Google identity no longer matches the stored one and a new sign-in would create a second account; the refresh-token session keeps them signed in meanwhile, and relinking is a support action.
