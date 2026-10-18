# Uptime Kuma monitor list (#828)

What to add in Uptime Kuma after the owner steps in `infra/RUNBOOK.md` section 5. Kuma 2.x has no import file for monitors (the JSON backup and import of 1.x was removed), so this table is the source of truth and the monitors are created by hand in the UI (about ten minutes). Replace `<API_HOST>`, `<WEB_HOST>`, `<SITE_HOST>` and `<GLITCHTIP_HOST>` with the real hosts (`API_HOST` and `WEB_HOST` are in `infra/staging/.env`).

Defaults for every row: heartbeat interval 60 s unless stated, **Retries 1** for the URL monitors (one retry before DOWN, so the alert fires on the second consecutive failure); **Retries 0** for the push monitors (their retry interval would otherwise stretch a missed ping to twice the heartbeat interval). Notifier: the e-mail (SMTP) notifier set up once and attached to all monitors.

## URL monitors (pull)

| Name | Type | Target | Interval | Alert when | Notes |
| --- | --- | --- | --- | --- | --- |
| API health | HTTP(s) | `https://<API_HOST>/api/v1/health`, accept `200-299` | 60 s | 2 consecutive failures | `/health` answers 503 when the database is unreachable, so this covers API and database |
| Website | HTTP(s) - Keyword | `https://<SITE_HOST>/`, keyword: a stable phrase from the landing page (owner picks one) | 60 s | 2 consecutive failures | The keyword guards against a 200 that serves an error page |
| Web app | HTTP(s) | `https://<WEB_HOST>/`, accept `200-299` | 60 s | 2 consecutive failures | Only if the web app has its own host (`WEB_HOST`) |
| TLS, API host | on the API health monitor | tick "Certificate Expiry Notification" | - | certificate expires in under 14 days | In Settings > Notifications > TLS Expiry set the days to `14` |
| TLS, website host | on the Website monitor | tick "Certificate Expiry Notification" | - | under 14 days | Same setting; one per domain |
| GlitchTip | HTTP(s) | `https://<GLITCHTIP_HOST>/`, accept `200-299` | 300 s | 2 consecutive failures | Only once GlitchTip is installed; an outage means errors are lost, not that the app is down |

## Push monitors (the job reports in)

Create each as type **Push**, copy its push URL, and put it in the named variable of `infra/staging/.env` **in single quotes** (the URL holds `&`; the file is sourced by the shell). The URL is a secret: it is a credential in the path, so it goes only in `.env` and into Kuma, never in a ticket or a chat. The jobs send it to curl on stdin. Empty variable = no heartbeat. Caddy's access and error logs on the Kuma host cut the token from the path (`infra/caddy/Caddyfile.kuma`).

| Name | Variable | Sent by | Heartbeat interval | Alert when |
| --- | --- | --- | --- | --- |
| Nightly backup | `BACKUP_HEARTBEAT_URL` | `infra/staging/backup.sh`, after dump, upload and retention succeed (also the backup before a production release) | 25 h (90000 s) | no ping for 25 h; a failed run sends nothing, so it alerts too |
| Restore rehearsal | `RESTORE_HEARTBEAT_URL` | `infra/staging/restore-check.sh`, after a fully successful monthly run | about 32 days (2764800 s) | no ping for 32 days. Kuma 2.5.6's source has no upper bound on the interval; confirm the UI accepts the value when you create it |
| Erasure ledger upload | `LEDGER_HEARTBEAT_URL` | `infra/staging/ledger-upload.sh`, after a fully successful upload (cron, hourly: `infra/RUNBOOK.md` section 3a) | about 2 h (7200 s) | no ping for 2 h; a failed upload sends nothing |

## Not monitored here

- Kuma itself. If its host dies, nobody is told. An accepted gap for a one-person project; a second free check (for example a phone reminder to open the status page weekly) is the owner's call.
- Application errors: those go to GlitchTip, not to Kuma.
