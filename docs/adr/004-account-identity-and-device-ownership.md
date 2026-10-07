# ADR 004: Account identity and device ownership

- Status: Accepted
- Date: 2026-10-08

## Context

ADR 003 left two questions open (#17). First, whether a Google sign-in and an email-code sign-in for the same address reach the same account; the plan's fallback story ("email still works if Google fails") only holds if they do. Second, what happens to records queued offline on a device when a different account signs in on it; health and food data must never be pushed under another user's id. The server cannot detect the second case: a push made with user B's token looks like B's data whatever the device had queued.

## Decision

- **Google identities are keyed by `sub`,** Google's stable user id, never by email. Email is used once, when a Google identity is first seen, to decide which account it joins.
- **One account per verified email.** When a Google ID token carries `email_verified: true` and an account already exists for that address (from an earlier email-code sign-in, or vice versa), the new identity is linked to that account in `auth_identities`; the response carries `new_user: false`. "Same address" means trimmed and lower-cased, with no Gmail dot or plus folding. A Google token without `email_verified: true` is refused with the existing 401 `unauthorized`; no new error code.
- **The local store belongs to one user.** The app records the user id the store belongs to and compares it with `TokenPair.user.id` after every token exchange, before any push.
- **Unsynced changes block leaving the account.** While the queue is non-empty, sign-out offers only "Sync now, then sign out" and "Discard and sign out" (explicit confirmation stating how many changes are lost). If the session has expired, signing in as the same user pushes the queue; signing in as a different user is refused after the token exchange, the new tokens are discarded, and the choices are "Sign in as the previous user to sync" and "Discard and sign out".
- **Switching users wipes the store.** Signing in as a different user with an empty queue deletes the previous user's local store, photo vault included, before the first write.
- **This guard lives entirely in the app.** The server only guarantees that `user_id` comes from the token.

## Consequences

- Backend: `auth_identities` holds `(provider, provider_subject)` unique per row and many rows per user; lookup is by subject, linking by normalised verified email.
- A Google-side email change does not break sign-in, since the identity is keyed by `sub`. A recycled email address cannot take over an account, since an existing Google identity is never re-pointed by email.
- A refused different-user sign-in may already have created that user's account on the server (first sign-in creates the account). That is harmless: it holds no data.
- No sign-out endpoint exists in contract v0, so after "Discard and sign out" the server-side refresh token stays valid until it expires or is rotated. The device deletes its copy, which is the only place the token lives. Accepted for M0; a later contract PR may add `POST /auth/sign-out` to revoke the family.
- The app needs one Jest or Maestro test proving that a record queued by user A is never pushed with user B's token (#31).
