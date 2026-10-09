# Error tracking and uptime: proposal (#306)

Status: proposal only. Nothing is installed. Licences checked 2026-10-09 against the upstream LICENSE files; re-check before installing.

The plan (`docs/development-plan.md`, Monitoring) names Sentry free tier and UptimeRobot. Both are hosted vendor services with their own terms, which conflicts with the open-source-only rule. `docs/` is owned by Shubham, so the plan text is not edited here; if you accept this proposal, update that row.

## Options and licences

| Need | Proposed | Licence | Notes |
| --- | --- | --- | --- |
| Error tracking | GlitchTip (self-hosted) | MIT (glitchtip-backend, checked 2026-10-09) | Accepts events from Sentry SDKs; Django + PostgreSQL; light enough for the free ARM VM |
| Uptime | Uptime Kuma (self-hosted) | MIT (github.com/louislam/uptime-kuma, checked 2026-10-09) | Web UI, HTTP/TCP/keyword checks, status page, many notifiers |
| Alert delivery | SMTP email, or ntfy (self-hosted or public server) | ntfy Apache-2.0 | Email needs an SMTP account you already have; skip Telegram/Slack (vendor terms) |

Rejected: self-hosted Sentry, because it is under the Functional Source License (FSL-1.1-Apache-2.0), which is source-available and not open source until each release converts to Apache-2.0 after two years. Hosted Sentry and UptimeRobot, as above. Alternative to Uptime Kuma if you want config-as-code: Gatus (Apache-2.0).

SDK note: the Sentry client SDKs (JS, React Native, Java) are separately MIT-licensed and are how apps talk to GlitchTip. Using the SDK does not mean using the Sentry service. Confirm each SDK's LICENSE when the App and Backend agents add them.

## Where it runs

- Uptime Kuma must not live on the VM it watches, or an outage of that VM also silences the alert. Oracle Always Free lets the ARM allowance (checked 2026-10-09: 4 OCPU and 24 GB total) be split across VMs, so use a small second VM, or any always-on machine you own. Oracle can reclaim idle free VMs; the nightly backup in #36 is the fallback for state.
- GlitchTip can share the staging VM at first (PostgreSQL is its only hard dependency), but it adds a second database engine next to MySQL. Keep it in its own Compose project so it can be moved. Expect roughly 1 GB of RAM; measure before committing.
- Verify arm64 images exist for GlitchTip and Uptime Kuma before installing (both publish multi-arch images as far as known; not verified here).
- Put each behind Caddy (Apache-2.0) with HTTPS; see `infra/caddy/Caddyfile.site` for the pattern.

## What to monitor

Uptime Kuma, interval 60 s (the plan asked for 5 minutes; self-hosting has no free-tier limit):

| Check | Type | Alert when |
| --- | --- | --- |
| API health | HTTP(s) GET the backend health endpoint, expect 200 | 2 consecutive failures |
| Website | HTTP(s) GET `/`, keyword match on a stable phrase | 2 consecutive failures |
| TLS certificate | Certificate expiry on both domains | under 14 days |
| Backup heartbeat | Push monitor; the nightly backup job curls the push URL on success | no heartbeat for 26 h |

The backup heartbeat needs one `curl` line at the end of the backup script in `infra/` once #36 lands; it is not added here.

## Error tracking rules

- Projects: `api` and `mobile`, one DSN each, DSNs stored as environment variables or GitHub secrets, never committed.
- Privacy (repo rule: logs never contain food, weight, health answers or tokens): the same applies to events. Disable default PII, drop request bodies and breadcrumbs from network and console, and add a `beforeSend` scrub on the app and API. Review a sample event before enabling in production.
- Retention: 30 days, matching backups, to keep the database small.
- Releases: tag events with the Git tag so a regression maps to a release; rollback is the previous image tag (see `infra/RUNBOOK.md` when it exists).

## Install outline (do not run yet)

1. Provision the second VM or choose the host; open 80 and 443 only.
2. Uptime Kuma: official Docker image, one volume for `/app/data`, behind Caddy. Create the admin user, add the checks above, add the email or ntfy notifier.
3. GlitchTip: official Docker Compose (web, worker, PostgreSQL), set `SECRET_KEY`, `DATABASE_URL`, `GLITCHTIP_DOMAIN`, SMTP settings and `ENABLE_USER_REGISTRATION=false` after creating your user.
4. Open follow-up issues for the App and Backend agents to add the SDK, DSN env var and scrubbing, each with a test that an event contains no health fields.

## Decisions for you

1. Accept GlitchTip + Uptime Kuma, or prefer a different open-source stack.
2. Where Uptime Kuma runs (second Oracle VM, or a machine you own).
3. Alert channel: email via an SMTP account you already have, or ntfy.
