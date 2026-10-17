# Account deletion by email: operator runbook

Status: draft runbook (#831). Not legal advice. Steps marked **Counsel** must be confirmed with a lawyer before launch. Placeholders in `[brackets]` are filled in by the owner, the same way as on the site's legal pages. The reply templates below are drafts pending the lawyer review of the privacy, terms and deletion pages.

Use this runbook when someone who cannot use the app asks by email for their account to be deleted, as the "If you cannot use the app" section of `/delete-account/` (`apps/site/src/pages/delete-account.astro`) promises. Anyone who can still open the app should use "Your data" > "Delete everything" instead: it is immediate and needs nobody. Breaches are handled in [`INCIDENT-RESPONSE.md`](INCIDENT-RESPONSE.md); deploy, backup and restore in [`infra/RUNBOOK.md`](../infra/RUNBOOK.md).

There is no admin endpoint and nobody edits MySQL by hand: the 16 synced tables, the conflict log, sessions and codes are removed together by the same `DELETE /me` the app calls. The operator proves that the requester controls the mailbox with the sign-in code endpoints, then deletes with the token they return.

## Who and where

| | |
| --- | --- |
| Handler | [operator name] (the incident lead in `INCIDENT-RESPONSE.md`; one person may hold every role while the team is small) |
| Requests arrive at | [privacy contact email], subject "Delete my account" (the page asks for that subject; act on any clear deletion request whatever the subject) |
| Request log | the private request log below, kept outside this repository |
| Deadline | the page's draft target: done and confirmed **within 30 days of the confirmed request**, that is of the reply with a valid code. Reply to the first email well before that; the clock that matters to the requester starts when they write |

**Counsel:** confirm the period for acting on an erasure request under the DPDP Act 2023 (section 12) and the DPDP Rules 2025 in force on the date. The Rules' provisions on data principals' rights are among those that commence on 13 May 2027 (see the commencement source in `INCIDENT-RESPONSE.md`). The privacy page still has `[Response time we commit to …]` and `[grievance response period]` open; keep this runbook's deadline in step with whatever is chosen there.

## What `DELETE /me` deletes

Checked against `AccountService.delete`, `AccountRepository.deleteAll`, the foreign keys in `backend/src/main/resources/db/migration/` (every per-user table cascades from `users`) and the `DELETE /me` description in `packages/api/openapi.yaml`. It is the same list as "What gets deleted" on the deletion page.

- **Deleted at once, in one transaction, before the API answers 204:** the account, its email (and any Google) sign-in identity, every refresh token and session, all rows of the 16 synced tables (tombstones included), the conflict log, the per-user sync bookkeeping, the daily AI usage counters, and, for the account's email address, any pending one-time codes and wrong-code records. No undo. If anything fails the transaction rolls back, the API answers 500 and nothing is deleted. A repeat call is safe (204 again).
- **Not deleted:** the anonymous monthly AI token total (month and count only, no user id); server logs, which hold an opaque user id and never food, weight, health answers or tokens (API logs and web server error lines at most 14 days, access logs with masked IPs and no user id at most about 15 days); crash reports, if crash reporting is on ([error report retention period], see the privacy page).
- **Backups:** nightly dumps are not edited. The deleted data disappears from them when they expire, at most 30 days after the deletion (`infra/RUNBOOK.md` section 3; still "[Planned policy to confirm …]" on the deletion and privacy pages).
- **Outside the server:** data on the requester's own devices stays there until they clear it (a signed-in device is signed out the next time it contacts the server). Progress and kitchen-test photos never reach the server.
- **Kept by this process:** the request email thread in [privacy contact email] (it holds the address and a used, expired code) and the request log. **Counsel:** confirm how long to keep both.

Known gap, not specific to this runbook: restoring a backup brings back every account deleted after that backup was taken, whichever way it was deleted. Do not restore production from a backup older than the newest deletion without deciding with **Counsel** how to redo those deletions.

## Before you start

- Work from a trusted machine: your own, up to date, not shared, with `curl` (7.84 or later) and `jq`. Not a CI runner, not a shared server, not a screen share.
- Use the **production** API: `API_HOST` is the production value from `infra/RUNBOOK.md` section 4a. Staging has different accounts.
- Never paste a code, an access token or a refresh token into an issue, ticket, chat, the request log or an email. The commands below read the address and the code with `read`, so neither lands in shell history, and send every secret on standard input, so none appears on a command line (`ps`). Close the terminal when done.
- The code proves only that whoever replied can read that mailbox; it does not prove who the person is. As the deletion page says, nothing is deleted on the strength of the sender address alone: a `From` line can be forged, the code cannot. Never send a code to any address other than the account's own.
- Each code request sends a real email to that address. Do not send codes to an address nobody asked about, and do not send more than you need.
- If the API is stopped during an incident (`INCIDENT-RESPONSE.md`, Contain step 3), log the request, tell the requester it is queued (adapt template A), and run the steps once the API is back. The deadline still runs.

## Steps

### 1. Log the request and reply

Add a row to the request log (below). Reply with template A, and only send the code (step 2) when you can watch the inbox for the next 10 minutes.

### 2. Send the code

A code expires **10 minutes** after it is sent (`AuthService.CODE_TTL`) and a new code replaces the previous one. Steps 2 and 3 must happen inside those 10 minutes, so agree a time with the requester if replies are slow.

```sh
API="https://$API_HOST/api/v1"
printf 'Account email address: '; read -r EMAIL
jq -n --arg email "$EMAIL" '{email: $email}' |
  curl -sS -i -w '\n' -X POST "$API/auth/email/start" -H 'Content-Type: application/json' --data-binary @-
```

- **202** with `code_expires_at` (UTC) and `resend_after_seconds`: the API has handed a "Your Plate & Bar sign-in code" email to the SMTP provider. Send template B now.
- **202 is also the answer when the address has no account** and when delivery failed (the endpoint never reveals either). If the requester says nothing arrived, check the API log on the VM for `Sign-in code delivery failed` (`docker compose logs --since 30m api | grep 'Sign-in code delivery failed'`) and ask them to check spam.
- **429** `rate_limited`: see Rate limits below. Wait the `Retry-After` seconds shown in the headers before trying again.
- **400** `invalid_request`: the address is not a valid email (or is over 254 characters). Check it against the request.

### 3. Verify the code and delete

Run this as soon as the reply with the code arrives, in the same terminal (it needs `API` and `EMAIL` from step 2). It verifies the code, deletes the account straight away, then checks that the session is gone.

```sh
printf 'Code from the reply: '; read -r CODE
RESP=$(jq -n --arg email "$EMAIL" --arg code "$CODE" '{email: $email, code: $code}' |
  curl -sS -w '\n%{http_code} %header{retry-after}' -X POST "$API/auth/email/verify" \
    -H 'Content-Type: application/json' --data-binary @-)
LAST=$(printf '%s\n' "$RESP" | tail -n 1); BODY=$(printf '%s\n' "$RESP" | sed '$d')
echo "verify: HTTP $LAST"
if [ "${LAST%% *}" = 200 ]; then
  printf '%s\n' "$BODY" | jq '{new_user, user_id: .user.id}'
  ACCESS=$(printf '%s\n' "$BODY" | jq -r .access_token)
  REFRESH=$(printf '%s\n' "$BODY" | jq -r .refresh_token)
  printf 'Authorization: Bearer %s\n' "$ACCESS" |
    curl -sS -o /dev/null -w 'delete: HTTP %{http_code}\n' -X DELETE "$API/me" -H @-
  jq -n --arg t "$REFRESH" '{refresh_token: $t}' |
    curl -sS -o /dev/null -w 'session check: HTTP %{http_code}\n' -X POST "$API/auth/refresh" \
      -H 'Content-Type: application/json' --data-binary @-
else
  printf '%s\n' "$BODY"
fi
unset CODE RESP BODY LAST ACCESS REFRESH
```

Read the result:

| Output | Meaning | Next |
| --- | --- | --- |
| `verify: HTTP 200`, `"new_user": false`, `delete: HTTP 204`, `session check: HTTP 401` | The account existed and is deleted. | Template C. Log it as done. |
| `verify: HTTP 200`, `"new_user": true`, `delete: HTTP 204`, `session check: HTTP 401` | There was **no account** for this address: verify created one (it creates the account on first sign-in, by contract) and the delete removed it again at once. | Template D. Log it as "no account". |
| `delete:` anything but 204 | Nothing was deleted (a 429 or 500 rolls back); the account is still there, including one verify just created. | Wait out any `Retry-After`, then send a new code (step 2) and run step 3 again. Verify then says `"new_user": false` because the account exists; use the template for what the first run showed (D if it said `true`). |
| `verify: HTTP 401`, `invalid_code` | Code wrong, expired (over 10 minutes), already used, or 5 wrong tries on it. Every wrong try counts against the address. | Do not guess or retype variants. Check the reply for a typo once; otherwise send a new code (step 2) and template B again. |
| `verify: HTTP 429 <seconds>` | Too many wrong codes for this address, or too many verify calls from your IP. | See Rate limits. |

Never run steps 2 and 3 again "to check" that it worked: after a deletion, a new code and verify simply create a fresh, empty account (`new_user: true`), which is exactly what the block above deletes again, and the requester gets another code email for nothing. The proof is the 204 from the delete and the 401 from the session check.

The `user_id` printed is an opaque id; it is safe to note in the request log, and the API logs `Account deleted: user <id>` with it.

### 4. Reply and close

Send template C or D within the deadline, fill in the log row and close the thread. If the requester never replies with a code, send one reminder; close the request as "not verified" after [period to confirm with Counsel, for example 30 days] and tell them they can write again.

## Rate limits

All are defaults in `RateLimitProperties` (overridable with `app.rate-limit.*`; production sets only the trusted proxies). A 429 always carries `Retry-After` in seconds and means nothing happened.

| Limit | Default | Applies to |
| --- | --- | --- |
| Codes per address (`email-start-address`) | 5 per hour and 10 per day, refilled smoothly | `email/start`, whoever asks, including the requester trying the app themselves or someone else typing their address |
| Wrong codes per address (`email-verify-address`) | 10 per rolling hour and 20 per rolling day, across all codes (a new code does not reset it) | `email/verify`; while blocked, even the right code is refused |
| Wrong tries per code | 5, then the code is dead | `email/verify` |
| Code requests per IP (`email-start-ip`) | 10 per hour | your machine |
| Verify calls per IP (`email-verify-ip`) | 30 per hour | your machine |
| All `/auth` calls per IP (`public-ip`) | 30 per minute | your machine |
| Authenticated calls per user (`user`) | 120 per minute | `DELETE /me` |

If the address is limited, it was used heavily in the last hour or day: by the requester, or by someone else, which is worth a note in the log (no codes, no tokens). Wait the `Retry-After` time, tell the requester when you will send the code, and try again then. If the requester says they did not ask for those codes, check the security signals in `INCIDENT-RESPONSE.md` (Detect: `Rate limit hit (bucket=email-start-address …)`) for a wider pattern.

## Request log

Keep it private (not in this repository, not in a GitHub issue), one row per request. No health data, no codes, no tokens, and nothing from the email body beyond what the columns need. **Counsel:** confirm whether to record the email address at all, and how long to keep the log.

| Ref | Received (IST) | Code sent | Verified | Deleted | Reply sent | Outcome | Handler | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEL-[yyyy]-[nn] | | | | `user_id` and time, or n/a | | deleted / no account / not verified / withdrawn | | rate limits, retries |

## Reply templates

Drafts pending the lawyer review. Send from [privacy contact email], in the same thread, to the requester's address only.

### A. Request received

> Subject: Re: Delete my account
>
> We received your request to delete your Plate & Bar account and its data.
>
> To make sure the request comes from the owner of this email address, we will send a 6-digit sign-in code to this address [now / at the time we agree: time]. The email comes from [SMTP from address] with the subject "Your Plate & Bar sign-in code". When it arrives, reply to **this** email with the code within 10 minutes; the code stops working after that. If you miss it, just reply and we will send another.
>
> If you can still open the app, "Your data" > "Delete everything" deletes your account straight away.
>
> We only ask for a code by email in reply to a deletion request you sent us.
>
> [operator name], Plate & Bar

### B. Code sent

> Subject: Re: Delete my account
>
> We have just sent a 6-digit code to this address from [SMTP from address] ("Your Plate & Bar sign-in code"). Please reply to this email with the code within 10 minutes. Once we have it, we delete your account and confirm.
>
> If it has not arrived, check your spam folder, then reply and we will send a new one.

### C. Done

> Subject: Re: Delete my account
>
> Your Plate & Bar account has been deleted, on [date]. On our server, your account, your sign-in, your sessions, all your synced records and the conflict log were deleted immediately and cannot be recovered.
>
> What remains for a limited time: copies in our nightly backups, which expire at most 30 days from now [planned policy to confirm]; server logs, which hold only an opaque id and no food, weight or health answers, for at most 14 days; and one anonymous monthly AI usage total that cannot be linked to you. Details are at [site URL]/delete-account/.
>
> Data still on your phone or browser stays there until you remove it: uninstall the app or clear its data. If you sign in again later, a new, empty account is created; nothing from the deleted account comes back.
>
> Questions: [privacy contact email].

### D. No account found

> Subject: Re: Delete my account
>
> We found no Plate & Bar account for this email address, so there was nothing on our server to delete. (Checking it made a temporary empty account, which we deleted straight away.)
>
> If you used the app without signing in, your data is only on your device: uninstall the app or clear its data to remove it. If you signed in with a different email address, write to us from that address and we will start again.
>
> Questions: [privacy contact email].
