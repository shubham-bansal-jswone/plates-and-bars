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

- **Server logs** (`docker compose logs api` on the VM). They hold no food, weight, health answers or tokens, only opaque user ids with events. Look for bursts of `Request failed with 401` or `403`, `Unhandled exception`, unexpected `Export built: user …` or `Account deleted: user …` lines, and rate-limit `429`s from one source. Known gap: reuse of a rotated refresh token revokes that session (`AuthService`) but is not logged.
- **Error tracking**: GlitchTip once installed (`infra/OBSERVABILITY.md`, proposal only today). A new exception type in auth, sync or export is a signal.
- **Uptime**: Uptime Kuma on `/api/v1/health` (`infra/RUNBOOK.md` section 5). An unexplained outage, database loss or restore is an availability incident.
- **Backups**: an unknown object in, or a missing object from, the backup bucket; a bucket or token setting you did not change.
- **Infrastructure**: unknown SSH logins on the VM, changed `.env`, unexpected containers or images, provider security alerts.
- **Reports**: user emails to [privacy contact email] ("I see someone else's data", "I got a code I did not ask for"), security researchers, GitHub security advisories, gitleaks findings or a secret pushed to the repository.

## 2. Contain

Aim: stop further access without destroying evidence. Work from `infra/staging` (or the production equivalent) on the VM.

1. **Preserve evidence first**: `docker compose logs --timestamps > ~/incident-<date>-api.log` before any restart (restarts lose container logs). Note the running image: `docker compose images`. Copy the provider's access logs if it has them. Do not delete anything.
2. **Stop the leak**: if the API itself is leaking (wrong user's data, auth bypass), `docker compose stop api`. The app keeps working offline and queues changes; users lose only sync and AI.
3. **End every session**: replace `JWT_SIGNING_KEY` in `.env` and recreate the API (`docker compose up -d api`): access tokens signed with the old key stop working, and so do pending sign-in codes, whose hash key is derived from it (`AuthService`). Then revoke every refresh token:
   ```
   docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot plateandbar -e "UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE revoked_at IS NULL"'
   ```
   Users sign in again with an email code; their data on the device is untouched.
4. **Rotate any secret that might be exposed**: `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD`, `SMTP_PASSWORD`, `BACKUP_S3_*` keys (create a new token, delete the old one), GitHub deploy keys and the `staging` environment secrets. Check `GOOGLE_CLIENT_IDS` is unchanged.
5. **Switch AI off** if the AI path is involved: set every `AI_*_ENABLED` to `false` and `docker compose up -d api`.
6. **Roll back or fix forward**: previous image tag per `infra/RUNBOOK.md` section 2. If data was altered or destroyed, restore per section 4 into a scratch database first and compare.
7. Record each action with the time in the incident log.

## 3. Assess

Answer: what data, whose, how many, from when to when, and is it still exposed.

Where personal data lives:

| Place | What | Source |
| --- | --- | --- |
| MySQL `users`, `auth_identities` | Account id, email address, Google account identifier (Google sign-in is in the API; the app uses email codes today) | `backend/src/main/resources/db/migration/V1__baseline.sql` |
| `email_sign_in_codes` and failure records | Email address, hashed code, failed attempts | `V2__…`, `V3__…` |
| `refresh_tokens` | Session tokens (hashed), revocation state | `V1__baseline.sql`, `V7__…` |
| Sync tables | Profile (sex, age, height, weight, activity, goal, pregnancy or breastfeeding status, the six health-check answers, targets), consent records, food and water logs, day notes (steps, sleep, fasting), workouts, sets and lift stats, weights, body measurements, own foods, recipes, kitchen tests (notes; `has_photo` flag only), exclusions (including reason `pain` and joints), swaps, settings (including reminders) | `SyncTable` and record schemas in `packages/api/openapi.yaml`; `V4__sync_tables.sql` |
| Conflict log | Losing copies of the records above, newest 1,000 per user, up to 90 days | `ConflictLogEntry` in the contract; privacy page |
| AI usage | Daily request counter per user; monthly token total with no user id | `V5__…`, `V6__…` |
| Backup bucket | Nightly gzip dump of all of the above, 30 days | `infra/RUNBOOK.md` section 3 |
| API memory | AI answers for up to 24 hours; rate-limit buckets keyed by IP address | privacy page; `ratelimit/RateLimiter.java` |
| Server logs | Opaque user ids with events; no health data | privacy page; `infra/OBSERVABILITY.md` |
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

Fix the cause, ship it through the normal PR and review path, restore data if needed, bring the API back (`docker compose up -d api`, check `/api/v1/health`), and watch logs and error tracking closely for 7 days.

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
> What you can do: [e.g. "sign in again with a new code; we never ask for your code by email or phone; you can download or delete your data from 'Your data' in the app"].
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
