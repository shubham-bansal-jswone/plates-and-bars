# Error tracking and uptime (#306, #828)

Status: decided (#200, #687) and deployable but inert: `infra/monitoring/` holds a Compose project for each of GlitchTip and Uptime Kuma, Caddy site blocks, and a monitor list; nothing starts them until the owner has a host (`infra/RUNBOOK.md` sections 5a and 5b). The mobile app has the Sentry SDK wired, off unless a DSN is set (see "Mobile app wiring"); the backend SDK is wired the same way (#717, off unless `SENTRY_DSN` is set); GlitchTip and Uptime Kuma are not installed. Licences checked 2026-10-09 and again 2026-10-18 against the upstream LICENSE files (GlitchTip glitchtip-backend: MIT; Uptime Kuma: MIT); re-check before installing.

The plan (`docs/development-plan.md`, Monitoring) names Sentry free tier and UptimeRobot. Both are hosted vendor services with their own terms, which conflicts with the open-source-only rule. `docs/` is owned by Shubham, so the plan text is not edited here; if you accept this proposal, update that row.

## Options and licences

| Need | Proposed | Licence | Notes |
| --- | --- | --- | --- |
| Error tracking | GlitchTip (self-hosted) | MIT (glitchtip-backend, checked 2026-10-09) | Accepts events from Sentry SDKs; Django + PostgreSQL; light enough for the free ARM VM. PostgreSQL is the only hard dependency: checked against glitchtip-backend v6.1.8 (2026-10-09), whose compose file marks Valkey (BSD-3, Redis-compatible) as optional (`VALKEY_URL` empty disables it) |
| Uptime | Uptime Kuma (self-hosted) | MIT (github.com/louislam/uptime-kuma, checked 2026-10-09) | Web UI, HTTP/TCP/keyword checks, status page, many notifiers |
| Alert delivery | SMTP email, or self-hosted ntfy | ntfy: dual Apache-2.0 / GPL-2.0 (checked 2026-10-09) | Email needs an SMTP account you already have; skip Telegram/Slack (vendor terms) and the public ntfy.sh server (alerts would leave your infrastructure) |

Rejected: self-hosted Sentry, because it is under the Functional Source License (FSL-1.1-Apache-2.0), which is source-available and not open source until each release converts to Apache-2.0 after two years. Hosted Sentry and UptimeRobot, as above. Alternative to Uptime Kuma if you want config-as-code: Gatus (Apache-2.0).

SDK note: the Sentry client SDKs (JS, React Native, Java) are separately MIT-licensed and are how apps talk to GlitchTip. Using the SDK does not mean using the Sentry service. Confirm each SDK's LICENSE when the App and Backend agents add them.

## Where it runs

- Uptime Kuma must not live on the VM it watches, or an outage of that VM also silences the alert. Oracle Always Free lets the ARM allowance (checked 2026-10-09: 4 OCPU and 24 GB total) be split across VMs, so use a small second VM, or any always-on machine you own. Oracle can reclaim idle free VMs; the nightly backup in #36 is the fallback for state.
- GlitchTip can share the staging VM at first (PostgreSQL is its only hard dependency), but it adds a second database engine next to MySQL. Keep it in its own Compose project so it can be moved. Expect roughly 1 GB of RAM; measure before committing.
- arm64 checked 2026-10-18 with `docker buildx imagetools inspect`: `glitchtip/glitchtip:6.2.6`, `louislam/uptime-kuma:2.5.6-slim`, `postgres:17.11` and `caddy:2.11.7` each list `linux/arm64`. The compose files pin each by version and by the digest of that multi-arch index; `.github/workflows/monitoring-config.yml` re-checks arm64 on every change.
- GlitchTip 6.2.6 has server roles (`bin/start.sh`, read from the v6.2.6 tag): the default `SERVER_ROLE=web` serves HTTP only (no migrations, no task worker, no scheduler), `worker` runs `runworker --scheduler`, and `all_in_one` runs the migrations and one process that serves HTTP with the worker and scheduler embedded. The compose file sets `SERVER_ROLE=all_in_one`, so the Compose project has `glitchtip`, `postgres` and `caddy`, no separate worker and no Valkey. The embedded worker runs the scheduler too (django-vtasks 3.1 `asgi.py` builds a `Scheduler`; GlitchTip's schedule has `perform-maintenance` daily at 05:00, the retention sweep, and `send-alert-notifications` every 60 s). `test-config.sh` fails if the role is not `all_in_one`.
- Memory limits (`mem_limit`), set so each stack fits a small VM: GlitchTip 1 GB (all-in-one runs web, worker and scheduler in one container; `GRANIAN_WORKERS_MAX_RSS=512` recycles the web worker before the limit and `VTASKS_INGEST_CONCURRENCY=2` keeps the ingest queue small), its PostgreSQL 512 MB, Caddy 64 MB (about 1.6 GB in all); Kuma 512 MB and Caddy 64 MB (about 0.6 GB). Unmeasured: watch `docker stats` for a week and raise a limit if a container is OOM-killed.
- Sharing a VM. Kuma: never with the API (it must outlive it). GlitchTip: the staging stack needs about 2 GB (`infra/RUNBOOK.md`, free-tier section), so the two together are about 3.6 GB and fit a 4 GB VM with little headroom (8 GB is comfortable); the Oracle A1 quota was not re-checked on 2026-10-18 (the page loads its numbers dynamically; the owner checks it, see RUNBOOK). The catch is ports 80 and 443: the staging Caddy already holds them, and each monitoring project ships its own Caddy. So the supported layout is one host per project; putting GlitchTip on the staging VM means adding `Caddyfile.glitchtip`'s site block (without its global block) to the staging Caddy and attaching the networks, which is not shipped. Recommended: GlitchTip and Kuma each on its own small VM, or both on one separate VM with one of them behind the other's Caddy.
- Put each behind Caddy (Apache-2.0) with HTTPS; see `infra/caddy/Caddyfile.site` for the pattern.

## What to monitor

Uptime Kuma, interval 60 s (the plan asked for 5 minutes; self-hosting has no free-tier limit):

| Check | Type | Alert when |
| --- | --- | --- |
| API health | HTTP(s) GET the backend health endpoint, expect 200 | 2 consecutive failures |
| Website | HTTP(s) GET `/`, keyword match on a stable phrase | 2 consecutive failures |
| TLS certificate | Certificate expiry on both domains | under 14 days |
| Backup heartbeat | Push monitor; the nightly backup job curls the push URL on success | no heartbeat for 25 h |

The backup heartbeat is a `curl` at the end of `infra/staging/backup.sh`, sent only after a successful backup when `BACKUP_HEARTBEAT_URL` is set (`infra/RUNBOOK.md` section 5).

## Error tracking rules

- Projects: `api` and `mobile`, one DSN each, DSNs stored as environment variables or GitHub secrets, never committed.
- Privacy (repo rule: logs never contain food, weight, health answers or tokens; the same applies to events). Required settings, for the app, the API and the GlitchTip project itself:
  - Strip `Authorization`, `Cookie`, `Set-Cookie` and any token header; no query strings and no request or response bodies on events.
  - No user context beyond one opaque id (the account UUID); no email, name, IP address (`sendDefaultPii` false, IP scrubbing on in GlitchTip).
  - No screenshots, view-hierarchy capture or session replay in the mobile SDK.
  - Scrub navigation and route parameters (breadcrumbs, transaction names): record route templates, not values.
  - No Java local variables or frame vars in stack traces (backend SDK setting off).
  - Sanitize validation and exception messages that echo submitted values (for example Bean Validation or Jackson errors); report the field name and rule, not the value.
  - Console and network breadcrumbs off.
  - Tests in the App and Backend lanes build a worst-case event and assert on the full serialized event (the JSON the SDK would send), not on individual fields, that none of the above appears. Review a sample event in GlitchTip before enabling production.
- Retention: 30 days, matching backups, to keep the database small.
- Releases: tag events with the Git tag so a regression maps to a release; rollback is the previous image tag (see `infra/RUNBOOK.md` when it exists).

## Mobile app wiring (#687)

- SDK: `@sentry/react-native` (MIT, checked 2026-10-17; the version Expo SDK 58 pins). Initialised in `apps/mobile/app/_layout.tsx` only when `EXPO_PUBLIC_SENTRY_DSN` is set at build time; with no DSN the SDK is not started and sends nothing. The release workflows pass it from the optional environment variable `EXPO_PUBLIC_SENTRY_DSN` and set `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (`production` on `v*` tags, `staging` otherwise); the DSN goes in only after the privacy page and the Play data-safety answers are published (#748, #827; `infra/README.md`).
- `@sentry/cli` (a hard dependency of the SDK) is FSL-1.1-MIT, which is not open source. It is replaced by an empty MIT stub through npm `overrides`, and a test fails if any FSL package reaches the lockfile.
- Tracing is off (no sample rate, empty `tracePropagationTargets`, transactions dropped), so no `sentry-trace` or `baggage` header leaves the app.
- Scrubbing is fail-closed, in `apps/mobile/src/telemetry/scrub.ts` and tested on a probe event carrying a food name and a weight in every field (`apps/mobile/__tests__/error-tracking.test.ts`): the event is rebuilt from an allowlist; exception values, message, `logentry`, `extra`, `tags`, request, transaction and fingerprint never leave; breadcrumbs carry no message or data; the user is a random install id.
- Native Android crashes are sent by the native SDK and skip the JS `beforeSend`; they carry stack frames, device data, the install id and the scrubbed breadcrumbs only.
- The SDK adds `ACCESS_NETWORK_STATE` to the Android manifest. List it and crash reporting in the privacy notice and the Play data-safety answers (docs follow-up).
- Not done: source-map upload (needs the CLI; not wanted), and the app's `environment` and `release` in `Sentry.init` (#826). The API's release is `plateandbar-api@<API_TAG>` from the compose file (#827). The backend side of #687 and the backup heartbeat are done.

## Install (#828)

Owner steps, in order, are in `infra/RUNBOOK.md` sections 5a (Uptime Kuma) and 5b (GlitchTip): host and DNS, `.env` from `.env.example`, `docker compose up -d`, create the admin user, verify sign-up is closed, set the DSNs, add the notifier and the monitors. The monitor list with intervals is `infra/monitoring/MONITORS.md`.

What is in the repository, and what it enforces (`infra/monitoring/test-config.sh`, run by `.github/workflows/monitoring-config.yml`, no stack is started):

- `infra/monitoring/glitchtip/` and `infra/monitoring/uptime-kuma/`: `docker-compose.yml` and `.env.example` each; every secret is `${VAR:?...}` with no default, supplied from `.env` only.
- `infra/caddy/Caddyfile.glitchtip` and `Caddyfile.kuma`: HTTPS, the #714 log filters (JSON, IP masked to /24 or /48, query cut, headers dropped, 14 days) on the access log and on a global error log, HSTS and the usual headers. No CSP: the two single-page UIs are not pinned by this repo. The GlitchTip block drops `X-Forwarded-For` and `X-Real-IP` so events carry no client IP. The Kuma block also cuts the push token from `/api/push/<token>`, which is a credential.
- GlitchTip settings that are environment variables, set in the compose file: `ENABLE_USER_REGISTRATION=false` and `ENABLE_ORGANIZATION_CREATION=false`, `GLITCHTIP_RETENTION_DAYS=30` (events, logs, files; one knob for all types), `GLITCHTIP_PII_SCRUB_DEFAULT` (server-side scrubbing on for every project, including e-mail addresses), Valkey off, GlitchTip's own uptime and log features off. `ENABLE_USER_REGISTRATION=false` does not close sign-up until a first user exists (GlitchTip 6.2.6 `is_user_registration_open()` is true while no user exists), so the owner creates the user from the command line before Caddy is started (RUNBOOK 5b); `ENABLE_ORGANIZATION_CREATION=false` still lets that superuser create the organisation. Per-project IP scrubbing lives in the GlitchTip database and is a checklist step in RUNBOOK 5b.
- No workflow deploys these projects.

## Decisions for you

1. Accept GlitchTip + Uptime Kuma, or prefer a different open-source stack.
2. Where Uptime Kuma runs (second Oracle VM, or a machine you own), and where GlitchTip runs (own VM, or the staging VM with the extra Caddy wiring above).
3. Alert channel: email via an SMTP account you already have, or a self-hosted ntfy (not the public ntfy.sh).

## Caddy access log (#714)

`infra/caddy/Caddyfile.api` and `Caddyfile.web` each write a JSON access log with Caddy's `log` directive and the `filter` encoder, to `/data/api_access.log` and `/data/web_access.log` (the `caddy_data` volume of `infra/staging/docker-compose.yml`).

- Kept: timestamp, method, path, status, response size, duration, TLS version, host.
- Masked: the client IP (`remote_ip`, `client_ip`) to /24 (IPv4) or /48 (IPv6).
- Removed: the query string (it can carry an e-mail address), everything after `/foods/barcode/` in the API log (the scanned barcode, #944; typed or encoded junk, extra segments and the query too; any path prefix, any case, `%2f` accepted) which is logged as `/foods/barcode/{code}`, every request header (`Authorization`, `Cookie`, `X-Forwarded-For`, `User-Agent`), every response header (`Set-Cookie`). Caddy never logs request bodies.
- Retention: `roll_keep_for 336h` (14 days), rolled every 24 hours (`roll_interval 24h`, so the 14 days hold on a quiet host too), also at 10 MiB, at most 15 files. The API's own logs and Caddy's stderr error lines are a separate store, see "Container logs" below.
- Checks: `infra/scripts/check-caddy-access-log.sh` (grep for each filter; tested by `test-check-caddy-access-log.sh`), `caddy validate` in the `site-deploy.yml` job, and `infra/scripts/test-web-caddy.sh`, which sends a request with a query string, `Authorization`, `Cookie` and `X-Forwarded-For` and asserts none of them reach the log, then does the same with the API upstream down and asserts the 5xx error line holds no raw IP, query, `User-Agent` or `X-Forwarded-For`. The same test then sends three barcode lookups with the upstream down and asserts the error and API access lines hold `/foods/barcode/{code}`, not the barcode, with the IP masked. The check script pins `ipv4 24`, `ipv6 48`, `roll_interval 24h`, `roll_keep_for 336h`, the barcode rule and the reverse_proxy include; its test applies the two URI rules in both orders to sample URIs, so the barcode rule does not depend on running after the query cut. `Caddyfile.glitchtip` is checked as kind `glitchtip=` (same pins, no barcode rule).
- Error log: Caddy's own errors (a 502 or 503 with the API down carries the request) go to stderr (`docker compose logs caddy`) through a global `log errors` block in `infra/caddy/Caddyfile.stack` (a global block cannot live in an imported file) with the same IP mask, query cut, barcode rule and header drop. The block also includes the `http.handlers.reverse_proxy` logger: its WARN "aborting with incomplete response" (a client that drops mid-response) carries the URI, IP, query and User-Agent and used to reach the unfiltered default log, a gap since #714; Caddy removes a logger named in an `include` from the default log, which `caddy adapt` confirms for `Caddyfile.stack`, `.glitchtip` and `.kuma`. A second global block, `log default`, carries the same filters for every line no named log claims: an access line whose `Host` is not in Caddy's per-host log map (upper case, a trailing dot, an unknown host) would otherwise reach stderr with the URI, query, unmasked IP and `User-Agent`. `Caddyfile.stack`, `.glitchtip`, `.kuma` and `.site` (which has no other log) carry it; the check scripts pin it inside the block. `test-web-caddy.sh` proves it live with an upper-case and an unknown `Host`, and proves the reverse_proxy WARN (an upstream that cuts its response short) the same way. Using `Caddyfile.api` or `.web` alone, copy both blocks to its top. Its retention is the container-log rule below.
- Read it: `docker compose exec caddy tail -n 100 /data/api_access.log`. Caddy does not ship it anywhere.

## Container logs (#794)

`docker compose logs api` (the API's own logs), `docker compose logs caddy` (Caddy's stderr error lines) and `docker compose logs mysql` go through Docker's `journald` log driver (`infra/staging/docker-compose.yml`). Retention is journald's, set by the drop-in `infra/journald/plate-and-bar.conf`: journal files are closed every day (`MaxFileSec=1day`) and a file is deleted once its newest entry is older than 12 days (`MaxRetentionSec=12day`; journald judges a file by its newest or its first entry depending on version, and runs a day late at worst, so 12 + 1 + 1 keeps every entry within 14 days under either reading), so no entry is older than 14 days; `SystemMaxUse=200M` is a size cap for all journald data on the VM and can only delete sooner. So the guarantee is "kept for at most 14 days, less if the 200 MB cap is reached first". It holds only while the drop-in is installed (below) and journald is running; nothing in the backup or release scripts depends on it.

- One-time owner step on each VM, next to the VM set-up (#36): `sudo infra/journald/install.sh` (add `--dry-run` to preview). It is idempotent and restarts journald only when the file changed. Without it the journal falls back to the distribution defaults (large size caps, no age limit), so the 14 days are not enforced. Then run `docker compose up -d` so the containers are recreated with the journald driver (a changed log driver needs new containers; the old json-file logs go with the old ones).
- `docker compose logs` keeps working with this driver (Docker reads the journal back; the official Docker packages for Ubuntu and Debian on arm64 include the journald driver). Not run here without a VM: after the first deploy run `docker compose logs --tail 5 api` and `journalctl CONTAINER_NAME=plateandbar-staging-api-1 -n 5` once to confirm. Check the age bound with `journalctl --disk-usage` and `journalctl -n 1 --reverse` on the oldest end (`journalctl --since '15 days ago' | head -1` must show nothing older than 14 days).
- journald rate-limits per sending service, and all containers share one (the docker unit), so the default of 10,000 messages per 30 s is shared by mysql, api and caddy together; a burst above that is dropped with a "Suppressed N messages" line. The API logs far below that; check it when load testing.
- The drop-in applies to everything journald holds on the VM (system logs too). The journal is not part of any backup.
- Tests: `infra/journald/test-install.sh` (the drop-in's settings, the 14-day arithmetic, the installer's dry run, install, idempotency and drift repair, with a stub `systemctl`), and the `staging-config.yml` job, which also checks that the three services use the journald driver.
