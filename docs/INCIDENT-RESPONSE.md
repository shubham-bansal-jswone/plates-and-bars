# Incident response: personal data breach

Status: draft runbook (#694). Not legal advice. Every legal step here is marked **Counsel** and must be confirmed with a lawyer before launch and again during a real incident. Placeholders in `[brackets]` are filled in by the owner.

Use this runbook for any suspected personal data breach on the API, its database, its backups or the web app, even if it later turns out not to be one. Day-to-day operations (deploy, rollback, backup, restore) are in [`infra/RUNBOOK.md`](../infra/RUNBOOK.md).

## What counts as a personal data breach

The DPDP Act 2023 defines a personal data breach broadly: unauthorised processing, or accidental disclosure, acquisition, sharing, use, alteration, destruction or loss of access to personal data that compromises its confidentiality, integrity or availability (section 2(u); check the wording against the Act). Examples for this app:

- someone reads or copies the MySQL database, a backup dump or the backup bucket;
- a bug returns one user's records, export or conflict log to another user;
- a leaked `JWT_SIGNING_KEY`, database password or backup token;
- loss of user data with no usable backup (availability counts too);
- a sign-in code or session reaching the wrong person through our systems.

## Legal position (checked 2026-10-17)

| Duty | What the source says | Status |
| --- | --- | --- |
| Tell each affected user | DPDP Rules 2025, rule 7(1): without delay, in clear and plain language, through their user account or registered contact channel; describe the breach (nature, extent, timing), likely consequences, mitigation taken, what the user can do, and a contact who can answer questions. | Rule 7 comes into force 13 May 2027 [1][2]. **Counsel:** confirm what applies on the incident date. |
| Tell the Data Protection Board of India | Rule 7(2)(a): an intimation without delay (description, nature, extent, timing, location, likely impact). Rule 7(2)(b): a detailed report within 72 hours of becoming aware, or a longer period the Board allows on written request, covering updated facts, circumstances and reasons, mitigation, findings on who caused it, remedial steps, and a report on the notices given to users [1]. | As above. Timelines are per the DPDP Rules in force; confirm with counsel. **Owner:** record the Board's intimation channel here: [Board breach intimation channel]. |
| CERT-In | CERT-In directions of 28 April 2022 (IT Act s. 70B(6)) require service providers, intermediaries, data centres and body corporates to report listed cyber incidents within 6 hours of noticing them, at incidents@cert-in.org.in [3]. | In force. **Counsel:** confirm whether it applies to the operator and which incidents are reportable. |
| IT Act 2000 s. 43A and the SPDI Rules 2011 | Health conditions and medical records are sensitive personal data under the SPDI Rules; s. 43A makes a body corporate liable to pay compensation if negligence in reasonable security practices causes wrongful loss or gain. No separate breach-notice duty found in the SPDI Rules (CERT-In covers reporting). The DPDP Act s. 44(2) omits s. 43A, which ends the SPDI Rules' basis [4]. | Applies until that omission commences; sources say 13 May 2027, one disagrees [4]. **Counsel:** confirm it applies to the operator and what it requires during an incident. |

The Rules were notified as G.S.R. 846(E) on 13 November 2025; the official text is in the Gazette (egazette.gov.in). The summaries above come from secondary sources [1][2]; read the Gazette text before relying on any detail.

## Roles

One person may hold every role while the team is small. Write names and contacts here, not in an issue.

| Role | Who | Does |
| --- | --- | --- |
| Incident lead (data fiduciary contact) | [operator name], [privacy contact email], [phone] | Owns the incident, decides on notifications, signs notices |
| Technical responder | [name, contact] | Contains, preserves evidence, investigates, fixes |
| Counsel | [law firm or lawyer, contact] | Confirms legal duties, reviews notices before they go out |
| Communications | [name, or the incident lead] | Sends user notices, answers replies |
| Hosting and email providers | [hosting provider support], [SMTP provider support], [backup bucket provider support] | Logs and help on their side |

## 1. Detect

Open an incident (start the log at the end of this file) as soon as any of these is seen; triage happens inside the incident, not before it.

- **Server logs** (`docker compose logs api` on the VM). They hold no food, weight, health answers or tokens, only opaque user ids with events. What is logged today: `Unhandled exception`, `Service unavailable`, `Request failed with …` (Spring framework errors only, from `ApiExceptionHandler`), `Export built: user …`, `Account deleted: user …`, `AI call: user …`, `AI provider failed`, `AI reply unusable`, `Sync refused, account full`, `Sign-in code delivery failed (…)` (`AuthService`) and the `ClientIpResolver` error `Requests arrive from a private address with X-Forwarded-For …`. Unexpected bursts of export or deletion lines are the main signal; a burst of sign-in code delivery failures can mean the SMTP credentials were abused or revoked.
- **Security signals** (logger `app.plateandbar.security`, INFO, `SecuritySignalFilter`, #714): `Auth refused (status=401|403, method=…, path=<template>, reason=<code>)` for every refused request (reason codes such as `missing_token`, `unauthorized`, `invalid_code`, `forbidden`; an expired access token, `token_expired`, is routine and only logged at DEBUG), and `Rate limit hit (bucket=<name>, path=<template>)` where the bucket is the limit that refused: `public-ip`, `email-start-ip`, `email-verify-ip`, `email-start-address`, `email-verify-address`, `ai-ip`, `ai-user`, `export-ip`, `export-user`, `user` or `health-ip`. Path templates replace ids and anything that is not a plain word with `{id}`; no IP, e-mail, user id, token, header or query string is written. Refusals are capped at 5 lines per minute per client address and rate-limit hits at one per bucket and address per minute, so a flood shows as a steady drip, not as its true volume. Watch for a rise of `invalid_code` or `unauthorized` (credential guessing, a stolen or forged token) and of `Rate limit hit` on `email-start-ip`, `email-verify-ip`, `email-start-address` or `email-verify-address`. Reuse of a rotated refresh token is logged by `AuthService` (#709).
- **Caddy access log** (#714): one JSON line per request in `/data/api_access.log` and `/data/web_access.log` inside the `caddy` container (the `caddy_data` volume; read with `docker compose exec caddy tail -n 100 /data/api_access.log`). It holds time, method, bare path, status, size, duration and the client IP masked to /24 (IPv4) or /48 (IPv6). No query string, no request or response header (so no `Authorization`, `Cookie` or `X-Forwarded-For`), no body. Kept 14 days (rolled daily and at 10 MiB, 15 files at most). Caddy's own error lines (for example a 502 with the API down) go to `docker compose logs caddy` with the same filters, and like `docker compose logs api` they are kept for at most 14 days (journald, `infra/journald/plate-and-bar.conf`; less if its 200 MB cap is reached first; the owner installs the drop-in once per VM, `infra/OBSERVABILITY.md`). Because the IP is masked, it shows which network and how much, not which single client. Treat it as personal data.
- **Error tracking**: GlitchTip once installed (`infra/OBSERVABILITY.md`, proposal only today). A new exception type in auth, sync or export is a signal.
- **Uptime**: Uptime Kuma on `/api/v1/health` (`infra/RUNBOOK.md` section 5). An unexplained outage, database loss or restore is an availability incident.
- **Backups**: an unknown object in, or a missing object from, the backup bucket; a bucket or token setting you did not change.
- **Infrastructure**: unknown SSH logins on the VM, changed `.env`, unexpected containers or images, provider security alerts.
- **Reports**: user emails to [privacy contact email] ("I see someone else's data", "I got a code I did not ask for"), security researchers, GitHub security advisories, gitleaks findings or a secret pushed to the repository.

## 2. Contain

Aim: stop further access without destroying evidence. Work from `infra/staging` (or the production equivalent) on the VM.

1. **Preserve evidence first**: `docker compose logs --timestamps > ~/incident-<date>.log` before any restart or recreate (with the journald driver, recreating a container keeps its log entries, readable with `journalctl CONTAINER_NAME=<name>`, but journald keeps deleting entries older than 14 days whatever the cron does, so save them now). Note the running image: `docker compose images`. Copy the hosting provider's records if it has them. Do not delete anything, and stop the backup job from deleting for you: the nightly `backup.sh` writes a new dump (possibly of altered data) and then runs `rclone delete --min-age 30d` on everything under `BACKUP_S3_PREFIX`, which would remove the last clean restore point.
   - Pause the backup cron: comment out the `backup.sh` line with `crontab -e` and note the time in the incident log.
   - Copy every existing dump to a prefix outside `BACKUP_S3_PREFIX`, which the retention step does not touch. With the `.env` and `RCLONE_CONFIG_BK_*` set-up from `infra/RUNBOOK.md` section 4 step 1, run the same `docker run … rclone/rclone:1.74.0` command with `copy "bk:$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX" "bk:$BACKUP_S3_BUCKET/incident-<date>"` in place of `copyto …`. If `BACKUP_S3_PREFIX` is empty, retention covers the whole bucket, so copy to another private bucket instead. If request-level evidence is needed, copy the access logs out of the volume first (`docker compose cp caddy:/data/api_access.log .`); they are already filtered, and a temporary log with full IPs is a last resort: add one inside the site block of the Caddyfile the `caddy` service mounts (`infra/caddy/Caddyfile.api`) with a different `log` name, then `docker compose restart caddy`; it goes to `docker compose logs caddy`. Caddy logs `Authorization` and `Cookie` as `REDACTED` by default ([caddyserver.com/docs/caddyfile/directives/log](https://caddyserver.com/docs/caddyfile/directives/log)); the filter below drops query strings and headers (checked with `caddy validate`, caddy 2.11.7). Remove it when the incident closes, and treat the log as personal data (it holds client IP addresses).
   ```
   log {
   	output stderr
   	format filter {
   		request>uri regexp "\?.*$" ""
   		request>headers delete
   		resp_headers delete
   	}
   }
   ```
2. **Stop automatic deploys**: set the repository variable `STAGING_DEPLOY_ENABLED` to `false` (Settings > Secrets and variables > Actions > Variables) and pause merges to `main`. Otherwise a merge that touches the backend runs `deploy.sh`, whose `docker compose up -d` restarts a stopped API. When present, also set `PRODUCTION_DEPLOY_ENABLED` (production releases from `v*` tags, #711; they also end in `docker compose up -d`) and `WEB_DEPLOY_ENABLED` (the web app, #706) to `false`, and do not push release tags. Note which switches were `true` so Recover turns back on only those. The site deploy (`SITE_DEPLOY_TARGET`) does not touch the API or the web app.
3. **Stop the leak**: if the API itself is leaking (wrong user's data, auth bypass), `docker compose stop api`. The app keeps working offline and queues changes, but sync, sign-in, AI, server export, in-app "Delete everything" (`DELETE /me`) and content refresh all fail while it is stopped. Point users who want their account deleted to the email route on `/delete-account/` and handle those requests once the API is back ([`ACCOUNT-DELETION-RUNBOOK.md`](ACCOUNT-DELETION-RUNBOOK.md)). The API stays stopped until step 7.
4. **End every session**: put a new `JWT_SIGNING_KEY` in `.env`. Access tokens signed with the old key stop working, and so do pending sign-in codes, whose hash key is derived from it (`AuthService`). If the API is stopped (step 3), leave it stopped: it reads the new key when it comes back in step 7. If step 3 was skipped, `docker compose up -d api` now. Refresh tokens are SHA-256 hashes that do not depend on that key, so revoke them all; this needs only the `mysql` container:
   ```
   docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot plateandbar -e "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE revoked_at IS NULL"'
   ```
   Users sign in again with an email code; their data on the device is untouched.
5. **Rotate any secret that might be exposed**:
   - Database passwords, in this order. `mysql:8.4` applies `MYSQL_ROOT_PASSWORD` and `DB_PASSWORD` only when it first creates its data volume, and the healthcheck and `backup.sh` read the root password from the container's environment, so changing `.env` alone breaks the stack. Generate the new passwords with `openssl rand -hex 32` (hex only, so no quote or backslash can break the SQL or `sed`), and keep them in shell variables so they are never typed and never saved in shell history; only the variable names reach history. Change them inside MySQL while the container still has the old root password, then write them to `.env`:
     ```
     new_app="$(openssl rand -hex 32)"; new_root="$(openssl rand -hex 32)"
     if [ ${#new_app} -eq 64 ] && [ ${#new_root} -eq 64 ]; then
     docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' <<SQL && sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$new_app/; s/^MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=$new_root/" .env && echo "rotated; .env updated"
     ALTER USER 'plateandbar'@'%' IDENTIFIED BY '$new_app';
     ALTER USER 'root'@'%' IDENTIFIED BY '$new_root';
     ALTER USER 'root'@'localhost' IDENTIFIED BY '$new_root';
     SQL
     else echo "openssl gave no password: nothing changed"; fi
     unset new_app new_root
     ```
     (`.env` changes only if every `ALTER USER` succeeded. Use the `DB_USER` value if it is not `plateandbar`. The heredoc delimiter is unquoted on purpose so the variables expand, while `$MYSQL_ROOT_PASSWORD` stays inside the single-quoted `sh -c` and is read in the container.) Then run `docker compose up -d mysql` so the container's environment (and its healthcheck) gets the new root password. If the API is running, `docker compose up -d` recreates it with the new `DB_PASSWORD`; if it is stopped, it picks it up in step 7. Run `./backup.sh` once to check backups still work, only after the backup copy in step 1 is done (it runs the retention delete too).
   - `SMTP_PASSWORD` at the email provider, then `.env`.
   - `BACKUP_S3_*`: create a new bucket token, put it in `.env`, delete the old token.
   - Deploy access: the repository secrets `STAGING_SSH_KEY` and `SITE_SSH_KEY` (new key pairs), and remove the old public keys from `~/.ssh/authorized_keys` of the deploy-only users on the VMs.
   - Check `GOOGLE_CLIENT_IDS` is unchanged.
6. **AI**: AI is off today. Every `AI_*_ENABLED` flag defaults to `false`, `AI_MONTHLY_BUDGET_TOKENS` defaults to 0, and `StubAiProvider` is the only provider (`backend/src/main/resources/application.yml`, `backend/.../ai/`). `infra/staging/docker-compose.yml` does not pass any `AI_*` variable to the API, so setting them in `.env` has no effect. Once a provider is deployed and those variables are passed through, the off switch is `AI_*_ENABLED=false` or `AI_MONTHLY_BUDGET_TOKENS=0` in what the API container reads, then recreate the API.
7. **Bring the API back only with a fix**: a rolled-back tag (`infra/RUNBOOK.md` section 2: set `API_TAG`, then `docker compose up -d api`) or a fixed build. If data was altered or destroyed, restore per section 4 into a scratch database first and compare.
8. Record each action with the time in the incident log.

## 3. Assess

Answer: what data, whose, how many, from when to when, and is it still exposed.

Where personal data lives:

| Place | What | Source |
| --- | --- | --- |
| MySQL `users`, `auth_identities` | Account id, email address, Google account identifier (Google sign-in is in the API; the app uses email codes today) | `backend/src/main/resources/db/migration/V1__baseline.sql` |
| `email_sign_in_codes` and failure records | Email address, hashed code, failed attempts | `V2__…`, `V3__…` |
| `refresh_tokens` | Session tokens (hashed), revocation state | `V1__baseline.sql`, `V7__…` |
| Sync tables | Profile (sex, age, height, weight, activity, goal, pregnancy or breastfeeding status, the six health-check answers, targets), consent records, food and water logs, day notes (steps, sleep, fasting), workouts, sets and lift stats, weights, body measurements, own foods, recipes, kitchen tests (notes; `has_photo` flag only), exclusions (including reason `pain` and joints), swaps, settings (including reminders) | `SyncTable` and record schemas in `packages/api/openapi.yaml`; `V4__sync_tables.sql` |
| `sync_conflicts` (conflict log) | Losing copies of the records above, newest 1,000 per user, up to 90 days | `V4__sync_tables.sql`; `ConflictLogEntry` in the contract; privacy page |
| AI usage | Daily request counter per user; monthly token total with no user id | `V5__…`, `V6__…` |
| Backup bucket | Nightly gzip dump of all of the above, 30 days | `infra/RUNBOOK.md` section 3 |
| API memory | AI answers for up to 24 hours; rate-limit buckets keyed by IP address | privacy page; `ratelimit/RateLimiter.java` |
| Server logs | Opaque user ids with events; no health data | privacy page; `infra/OBSERVABILITY.md` |
| SMTP provider | Recipient email addresses and the sign-in code emails in its send logs | [SMTP provider]; `SMTP_*` in `infra/staging/.env.example` |
| AI provider | Request text for AI features (see the privacy page list) | [AI provider]; `apps/site/src/pages/privacy.astro` |

Never on the server, so outside a server breach: progress photos and kitchen-test photos (encrypted on the device, `apps/mobile/src/photos/vault.ts`), cycle and lab data (not built; device-only by design), and anything a user keeps on a device without signing in. A lost or stolen phone is the user's device, not our breach, unless our app made it worse.

Steps:

1. Find the entry point and the time window from logs and provider records.
2. List the tables or files reached. For each, count affected accounts with SQL on a restored copy, not on the live database.
3. Note whether the data includes health data (most sync tables do) and whether it was read, changed, deleted or only made unavailable.
4. Decide with counsel whether this is a personal data breach to notify. Record the decision and the reason even if the answer is no.

## 4. Notify

Order: Board intimation and user notices without delay once the breach is confirmed; the detailed Board report within 72 hours of becoming aware (rule 7(2)(b)), unless the Board grants more time on written request. Confirm the timelines with counsel on the day; they are per the DPDP Rules in force. CERT-In within 6 hours if counsel confirms it applies.

- **Users**: email each affected address from [privacy contact email] through the SMTP provider; that is the registered channel we hold. The app has no push or in-app message service. Send individual emails, never one mail with every address visible. Keep the list of addresses and send times for the Board report.
- **Board**: through [Board breach intimation channel]. Keep a copy of everything sent and any acknowledgement.
- **Providers**: tell the hosting, backup and email providers if their systems were involved.

## 5. Recover

Fix the cause, ship it through the normal PR and review path, restore data if needed, bring the API back with the fixed tag (`docker compose up -d api`, check `/api/v1/health`), process the deletion requests that came in by email ([`ACCOUNT-DELETION-RUNBOOK.md`](ACCOUNT-DELETION-RUNBOOK.md)), and watch logs and error tracking closely for 7 days. Before turning deploys back on, remove the temporary Caddy log by restoring the tracked file on the VM (`git checkout -- infra/caddy/Caddyfile.api`, then `docker compose restart caddy`); a modified tracked file makes the deploy's `git merge --ff-only` fail when a later change touches it. Then set back to `true` only the deploy switches that were on before (step 2), uncomment the backup cron line, and delete the `incident-<date>` backup copy when counsel agrees it is no longer needed.

## 6. Post-incident review

Within 2 weeks of closing, write a blameless review (keep it out of the public repository if it contains personal data or attack details): timeline, cause, what detected it and how fast, what was exposed, notices sent and when, what worked, what did not, and follow-up issues with owners. Update this runbook with anything that was wrong or missing.

## Templates

Fill every bracket. Counsel reviews each notice before it is sent.

### Notice to affected users (rule 7(1))

> Subject: Plate & Bar: a security incident affecting your data
>
> On [date], we found that [plain description of what happened]. It affected [what data, in plain words, e.g. "your food and weight logs synced between DATE and DATE"]. [It did not affect progress photos, which never leave your phone.]
>
> What this may mean for you: [likely consequences, e.g. "someone may have seen these records; your email address was also exposed, so be careful with emails claiming to be from us"].
>
> What we have done: [e.g. "closed the gap on DATE, signed every device out and changed our keys"].
>
> What you can do: [e.g. "sign in again with a new code; we never ask for your code by phone, and by email only in reply to a deletion request you sent us; you can download or delete your data from 'Your data' in the app"].
>
> Questions: [name], [privacy contact email], [phone].

### Initial intimation to the Board (rule 7(2)(a))

> Data fiduciary: [operator name], [address], contact [name, email, phone].
> Date and time we became aware: [timestamp, IST].
> Description: [nature of the breach], [extent: data types, number of data principals, approximate if not yet known], [timing: when it started and ended, or ongoing], [location: systems and hosting region].
> Likely impact on data principals: [impact].
> Immediate measures: [containment so far].
> A detailed report will follow within 72 hours of becoming aware, as required by rule 7(2)(b).

### Detailed report to the Board (rule 7(2)(b))

> Reference: [initial intimation date and reference].
> (i) Updated and detailed description: [facts as now known, final counts].
> (ii) Broad facts, circumstances and reasons: [timeline and root cause].
> (iii) Measures implemented or proposed to mitigate risk: [list].
> (iv) Findings on the person who caused the breach, if known: [findings].
> (v) Remedial measures to prevent recurrence: [list, with dates].
> (vi) Report on intimations to affected data principals: [number notified, channel, dates, copy of the notice attached].

## Incident log

Copy into the private incident record, one per incident.

| Time (IST) | Who | What was seen or done |
| --- | --- | --- |
| | | |

## Sources

1. DPDP Rules 2025, rule 7 summary: dpdpa.com/dpdparules/rule7.html (fetched 2026-10-17); official text G.S.R. 846(E), 13 November 2025, egazette.gov.in.
2. Commencement dates: scconline.com/blog/post/2025/11/14/meity-notified-digital-personal-data-protection-rules-2025/ and hlc.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force- (fetched 2026-10-17): rules 1, 2, 17 to 21 from 13 November 2025; rule 4 from 13 November 2026; rules 3, 5 to 16, 22, 23 (including breach intimation) from 13 May 2027.
3. CERT-In directions under IT Act s. 70B(6), 28 April 2022: summary at psalegal.com/new-cert-in-directions-overview-and-implications/ (searched 2026-10-17); official text on cert-in.org.in.
4. IT Act s. 43A, SPDI Rules 2011 and their omission by DPDP Act s. 44(2): ksandk.com/data-protection-and-data-privacy/what-happens-spdi-rules-after-dpdp-enforcement/ (searched 2026-10-17; one other source lists s. 44 as already in force). Official texts on indiacode.nic.in.
