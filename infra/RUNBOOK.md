# Staging runbook

Staging runs from `infra/staging/` on one VM: Caddy (HTTPS), the API and MySQL 8.4 in Docker Compose. This file covers set-up, backups, restore, rollback and monitoring. Backups are not automated until you add the cron line (section 3). The merge-to-`main` deploy exists but stays off until you enable it (section 2); no account has been created. Steps marked **Owner** need an account or a decision from Shubham.

Suspected personal data breach (leaked data, keys or backups, one user seeing another's records, data loss): follow [`docs/INCIDENT-RESPONSE.md`](../docs/INCIDENT-RESPONSE.md) before anything in this file, and preserve the API logs before any restart or rollback.

## Free-tier limits (checked 2026-10-12)

- Cloudflare R2: free tier of 10 GB-month of Standard storage, 1 million Class A and 10 million Class B requests per month (developers.cloudflare.com/r2/pricing, fetched 2026-10-12). One dump a day kept 30 days stays far below that unless the compressed dump grows past roughly 300 MB.
- Oracle Cloud Always Free: the page (oracle.com/cloud/free) lists "Arm-based Ampere A1 Compute" and Block Volume, but the quota numbers load dynamically and were NOT confirmed on 2026-10-12. The commonly quoted figures (4 A1 OCPUs, 24 GB RAM and 200 GB block storage in total; idle instances can be reclaimed; A1 capacity in a region is sometimes unavailable) must be checked by **Owner** before creating the VM. This stack needs about 2 GB RAM. The optional monitoring stacks (section 5) add GlitchTip about 1.6 GB (memory limits 1 GB, 512 MB, 64 MB) and Uptime Kuma about 0.6 GB on its own host, so staging plus GlitchTip on one VM is about 3.6 GB.

Any S3-compatible bucket works: `backup.sh` only needs `BACKUP_S3_*` variables, so MinIO or another provider can replace R2 (the decided retention is 30 days either way).

## 1. VM set-up (once)

1. **Owner:** create the VM (Ubuntu 24.04 arm64 image) and open ingress TCP 80, 443 and UDP 443 plus SSH (22, ideally restricted to your IP) in the cloud security list. Also open the same ports in the VM firewall (`sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT`, `sudo iptables -I INPUT -p udp --dport 443 -j ACCEPT`, then persist with `netfilter-persistent save`); Oracle images ship with restrictive rules.
2. **Owner:** point the DNS record for `API_HOST` at the VM's public IP.
3. Install Docker Engine and the Compose plugin from Docker's apt repository (<https://docs.docker.com/engine/install/ubuntu/>).
4. `git clone` the repository to `/opt/plateandbar` (full history: the API needs `CONTENT_UPDATED_AT`).
5. `cd /opt/plateandbar/infra/staging && cp .env.example .env && chmod 600 .env`, then fill every value. `APP_RATELIMIT_TRUSTEDPROXIES` is fixed in `docker-compose.yml` to the pinned Compose subnet `172.28.0.0/24`, which is where Caddy connects from; see `infra/caddy/Caddyfile.api` and `infra/README.md` for why.
6. **Owner:** before the first start, `sudo /opt/plateandbar/infra/journald/install.sh` (once per VM; idempotent). It bounds container logs (the API's and Caddy's error lines) to 14 days; without it journald keeps them under its distribution defaults (`infra/OBSERVABILITY.md`, "Container logs"). On an existing VM, run it, then `docker compose up -d` so the containers use the journald log driver.
7. First start:
   ```
   tag="$(git rev-parse --short HEAD)"
   CONTENT_UPDATED_AT="$(../../backend/scripts/content-updated-at.sh)" API_TAG="$tag" docker compose build api
   sed -i "s/^API_TAG=.*/API_TAG=$tag/" .env   # only after a successful build
   docker compose up -d
   curl -fsS https://$API_HOST/api/v1/health
   ```
   The first request makes Caddy fetch the certificate; it needs ports 80 and 443 reachable from the internet.
8. **Owner:** once, after the first deploy, check that logs come back through journald: `docker compose logs --tail 5 api` must print lines (and `journalctl CONTAINER_NAME=plateandbar-staging-api-1 -n 5` too).

## 2. Update and rollback

Update: `git pull`, then repeat the commands of step 7. Each build tags the image `plateandbar-api:<API_TAG>`, so earlier tags stay on the VM. `API_TAG` lives in `.env`, so any later plain `docker compose up -d` runs the same tag.

Rollback = previous image tag: `docker image ls plateandbar-api`, set `API_TAG=<previous tag>` in `.env`, then `docker compose up -d api` (no `build`). Flyway migrations are forward-only: if the bad release added a migration, restore the last backup (section 4) as well, or ship a fix forward.

Automatic staging deploy (#411): `.github/workflows/staging-deploy.yml` does the update above on every merge to `main` that touches the backend, content, `packages/api/openapi.yaml` or staging files, using `infra/staging/deploy.sh`. The script tags the image with the 12-character commit sha, polls `/api/v1/health` for up to 5 minutes and, if it fails, sets `API_TAG` back to the previous tag and recreates the API (rollback by hand is the same; not to an image built before #887, see section 3a). The checkout stays on `main` (the workflow uses `git merge --ff-only`), so keep the VM checkout clean and do not commit on it. **Owner:** to switch it on, create the VM and the deploy-only SSH user, then set the repository variable `STAGING_DEPLOY_ENABLED=true` and the `staging` environment values listed in `infra/README.md` (Staging deploy). The health poll goes through the local Caddy (`curl --resolve <API_HOST>:443:127.0.0.1`), so a VM that cannot reach its own public address still deploys. Re-running an old workflow run is intended to deploy the current checkout HEAD (the fast-forward to the old sha is a no-op), not the old sha; to run an older build use the manual rollback above. Tagged production releases are section 4a.

## 3. Nightly backup

`backup.sh` streams `mysqldump --single-transaction` through gzip to the bucket as `<prefix>/plateandbar-<UTC timestamp>.sql.gz` (uploaded as `.partial`, renamed only if the dump succeeded) and then deletes objects older than 30 days. rclone runs from the pinned `rclone/rclone` image with the remote defined from environment variables, so no credentials are written to disk besides `.env`.

1. **Owner:** create a private bucket and an API token limited to it (R2: Object Read and Write on that bucket only). Put the endpoint, bucket and keys in `.env` (`BACKUP_S3_*`).
2. Run it once by hand: `./backup.sh`, then list the bucket to see the object.
3. Add to the VM's crontab (`crontab -e`): `15 3 * * * cd /opt/plateandbar/infra/staging && ./backup.sh >> "$HOME/plateandbar-backup.log" 2>&1`
4. The dump contains user data: keep the bucket private and do not widen the token. Enable the provider's encryption at rest if it is not on by default.

## 3a. Erasure ledger upload (#853, #887)

Restoring a dump brings back every account deleted after it was taken. The API therefore appends `<user id>` TAB `<UTC time>` on every `DELETE /me` (#854) to `erasures-<UTC day>.log`, one file per UTC day in `ERASURE_LEDGER_DIR` on the `erasure_ledger` volume (#887; the variable replaced `ERASURE_LEDGER_PATH`). `ledger-upload.sh` runs every hour and copies each day to its own bucket object `erasure-ledger/<prefix>/erasures-<UTC day>.log`, outside `BACKUP_S3_PREFIX` so the 30-day backup retention does not touch it. Each object holds only that day's entries. Each run merges a day's object with the local lines (union of valid lines) and uploads the union, so a shorter local file (a fresh volume after VM loss) can never replace a longer bucket copy.

**45 days for every copy**, by whole UTC days (the 30-day backups plus margin): a day is kept while it is at most 45 days before today (UTC). The local day file and the day object of an older day are deleted on the next run, so an entry lives at least 45 days and at most 46 days plus one hour. The local files go first, even when the bucket cannot be reached. The same pruning runs under every prefix of the bucket (`erasure-ledger/<any prefix>/`), not only the VM's own, so "at most 46 days" holds whichever VM runs; the 47-day lifecycle rule (item 5 below) is the backstop. Any object older than 45 days under `erasure-ledger/` also goes (`rclone delete --min-age 45d`, which removes stale `.partial` uploads too). The oldest kept day is no longer uploaded, so an object that has already aged out does not come back. The nightly dumps do not contain the ledger (it is on its own volume). The ledger holds opaque ids and times only. Same `.env` credentials and pinned rclone as `backup.sh`; free tier as at the top of this file (a few hundred requests a day against 1 million a month, checked 2026-10-12; the run downloads all ledger objects in one container).

**Upgrade from the single file (#887), automatic and once:** the first run after the upgrade renames the old `erasures.log` to `erasures.log.migrating`, appends its entries to the day files (entries past 45 days are dropped), syncs them and only then removes it. It prints `erasures.log split into day files`. Old bucket snapshots `ledger-<date>.log` are split into day objects and deleted the same way (`split N snapshot object(s)`), and replay reads them until then. In that first run, the oldest kept day (45 days back) from the old file and snapshots is not uploaded. The VM keeps it until it is pruned the next day. R2 therefore lacks that one day, with entries 44 to 46 days old, which is still well past the 30-day backups. Everything written on the volume runs as the API's user (uid 10001) with `umask 077`, so the API can keep appending and the files stay owner-only.

**No rollback below #887.** An API image built before #887 reads `ERASURE_LEDGER_PATH`, which this compose file no longer sets, so it cannot start. It must also not run against this volume: it would write a single `erasures.log` next to the day files. `deploy.sh` therefore rolls back automatically only to an image labelled `app.plateandbar.erasure-ledger-dir=1`, which the compose build adds from #887 on. On the first staging deploy past #887 the previous image is older, so a failed deploy stops with `predates the per-day erasure ledger (#887)`, and the API stays down until you act. Production has no release before #887, so there it never happens. By hand, in this order:
1. Fix forward: get the fix onto `main` and run `./deploy.sh` on the VM (or let the workflow run).
2. Roll back to an older image built from #887 on, if there is one. Run `docker image ls plateandbar-api` and check that `docker image inspect -f '{{ index .Config.Labels "app.plateandbar.erasure-ledger-dir" }}' plateandbar-api:<tag>` prints `1`. Then set `API_TAG=<tag>` and `API_RELEASE=<tag without a leading v>` in `.env` and run `docker compose up -d api`.

Never roll the ledger scripts (`ledger-lib.sh`, `ledger-upload.sh`, `ledger-replay.sh`) back below #887 either. The #863 uploader would upload empty `ledger-<date>.log` snapshots, and the #863 replay reads only those, so it would report "nothing to delete" and pass while every day object is ignored.

1. **Owner**, once per VM, before `ERASURE_LEDGER_DIR` matters (the API already requires it): add to the crontab of the user that runs `backup.sh`: `5 * * * * cd /opt/plateandbar/infra/staging && ./ledger-upload.sh >> "$HOME/plateandbar-ledger-upload.log" 2>&1`. Run it once by hand and list `erasure-ledger/<prefix>/` in the bucket. With no deletion yet it uploads an empty object; that is correct, because replay fails when it finds no object at all.
2. **Owner**, optional: an Uptime Kuma **Push** monitor with a heartbeat interval of about 2 hours, URL in `.env` as `LEDGER_HEARTBEAT_URL` (single quotes, as `BACKUP_HEARTBEAT_URL`). A failed upload sends nothing.
3. Remaining window: deletions made since the last successful upload (up to about an hour) are lost if the VM and its volume are lost at once; there is no fix inside the free tier short of writing to the bucket on every request. Replay covers every older deletion. After VM loss the replacement starts a new local ledger; the old objects stay in the bucket and are still replayed until they pass 45 days.
4. A line that is not `<uuid> TAB <ISO UTC time>` is skipped and counted: upload warns, replay reports. A cut line comes only from a request that answered 500 and deleted nothing.
5. **Owner**, once per bucket (#911): the lifecycle backstop. `ledger-upload.sh` prunes the ledger only while a VM runs it; if a VM is retired, its day objects under `erasure-ledger/` would stay for ever. An R2 lifecycle rule expires every object under `erasure-ledger/` 47 days after it was last written (the 45-day retention plus one day past the script's own at most 46), for every prefix in the bucket. The script's own pruning stays the primary mechanism; the rule never cuts an entry below 45 days, because an object is last written at or after its newest entry. For a retired VM the last objects therefore go 47 days after their last write, one to two days later than the script would have deleted them; if the privacy page's wording must hold exactly for that case, ask **Counsel**.
   - R2 supports the S3 calls `PutBucketLifecycleConfiguration` and `GetBucketLifecycleConfiguration` (developers.cloudflare.com/r2/api/s3/api and /r2/buckets/object-lifecycles, read 2026-10-18). rclone has no lifecycle command, so `ledger-lifecycle.sh` uses curl with SigV4 and openssl. Both are open source; there is nothing to install on a current Ubuntu VM. Tested with curl 8.7.1 (`--aws-sigv4` needs a recent curl; older versions were not tested).
   - The `BACKUP_S3_*` token (Object Read and Write on one bucket) cannot read or change bucket configuration. Create a short-lived R2 API token with **Admin Read & Write**, run the following from `infra/staging` and delete the token afterwards. Do not put it in `.env`:
     ```
     export LIFECYCLE_S3_ACCESS_KEY_ID=<admin key id> LIFECYCLE_S3_SECRET_ACCESS_KEY=<admin secret>
     ./ledger-lifecycle.sh apply
     ```
     It prints `lifecycle rule put: erasure-ledger/ expires after 47 days`, then `lifecycle rule ok`. A second run prints `already applied` and changes nothing. The R2 dashboard (bucket, Settings, Object lifecycle rules) shows the rule `plateandbar-erasure-ledger-expiry`.
   - `PutBucketLifecycleConfiguration` replaces the bucket's whole configuration, so `apply` first reads the existing one and writes it back with every other rule kept as it was (R2's "Default Multipart Abort Rule", rules of your own, even a rule without an `<ID>`) and only our rule, found by its ID, replaced or added. A `404` other than `NoSuchLifecycleConfiguration` (for example a wrong bucket name) is an error, not an empty configuration; nothing is put.
   - Check it any time, with the same Admin token (an Admin Read only token is enough): `./ledger-lifecycle.sh check` exits non-zero unless the rule exists, is enabled, covers `erasure-ledger/` and says 47 days. The monthly rehearsal cannot run it, because the VM's token has no access to the configuration. Put it in the calendar with the rehearsal.
   - Not verified against a real R2 bucket yet: the script and its test (`test-ledger-lifecycle.sh`) run against a stub `curl`. The first run on the real bucket is the check; it verifies the rule by reading it back and fails loudly if R2 answers differently.

## 4. Restore

Use a scratch database first if you are only checking a backup.

1. Download a dump, from `infra/staging` (the first line loads `.env` into this shell; `lsf "bk:$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX"` in place of `copyto ...` lists objects; use the same rclone image tag as `backup.sh`):
   ```
   set -a; . ./.env; set +a
   export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other RCLONE_CONFIG_BK_NO_CHECK_BUCKET=true RCLONE_CONFIG_BK_ENDPOINT="$BACKUP_S3_ENDPOINT" RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
   docker run --rm -e RCLONE_CONFIG_BK_TYPE -e RCLONE_CONFIG_BK_PROVIDER -e RCLONE_CONFIG_BK_NO_CHECK_BUCKET -e RCLONE_CONFIG_BK_ENDPOINT -e RCLONE_CONFIG_BK_ACCESS_KEY_ID -e RCLONE_CONFIG_BK_SECRET_ACCESS_KEY -v "$PWD:/out" rclone/rclone:1.74.0 copyto "bk:$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<file>.sql.gz" /out/restore.sql.gz
   ```
2. Stop the API so nothing writes: `docker compose stop api`.
3. Recreate the database and load the dump:
   ```
   docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE plateandbar; CREATE DATABASE plateandbar"'
   gunzip -c restore.sql.gz | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot plateandbar'
   ```
   `DROP DATABASE` removes only the tables and data. The `MYSQL_USER` account and its grants on `plateandbar` live in the `mysql` system schema, so they still apply to the recreated database.
4. **Replay the erasure ledger before the API starts** (#853): `./ledger-upload.sh` first if the VM is alive (it adds the last hour's deletions), then `./ledger-replay.sh live`. It prints its target and refuses while the API container is running, so step 2 is enforced, not just advised. It fetches every object under `erasure-ledger/<prefix>/`, merges them and deletes every ledgered user id the dump still contains (the same per-user deletion as `DELETE /me`: the rows of `email_sign_in_codes` and `email_verify_failures` for the user's e-mail, which have no foreign key to `users`, then the `users` row, from which the other per-user tables cascade), printing only counts: `ledger replay ok: removed N user(s)`. A line that does not match is skipped and counted (`malformed line(s) skipped`; read the count, it is normally 0). The script fails only when the ledger is missing or unreadable: then do **not** start the API; fix the bucket access, or decide with **Counsel** how to redo the deletions. Do this after every dump load, including into a scratch database (`./ledger-replay.sh container <name>`). **Do not restore a dump older than 45 days without Counsel**: the ledger keeps entries only 45 days, and backups older than that exist only when `backup.sh` has been failing for more than 15 days (its 30-day retention runs only after a good dump), so deletions older than the ledger would come back.
5. `docker compose start api` and check `curl -fsS https://$API_HOST/api/v1/health`.
6. Delete `restore.sql.gz` from the VM.

Rehearsal on 2026-10-12: the dump and restore commands (not the bucket transfer) were run against a throwaway `mysql:8.4.11` container with a table and a trigger; the row count matched after restore. **Owner:** the full rehearsal against the real bucket (#36) is the first run of the monthly rehearsal below; record the date in the table.

### Monthly rehearsal (#829)

The plan requires a restore to be rehearsed once a month. `infra/staging/restore-check.sh` does it without touching the live database: it downloads the newest object under `BACKUP_S3_PREFIX` (same pinned rclone image and `.env` credentials as `backup.sh`), loads it into a throwaway `mysql` container (the stack's image tag, no network, no published port, removed on exit with its volume), prints the dump's age, every table with its row count and the latest Flyway migration in the dump next to the latest in the checkout, then tears everything down. It exits non-zero if the newest dump is older than 25 hours, is not a valid gzip, fails to load, or lacks `flyway_schema_history`, `users` or `sync_state`. After the table check it replays the erasure ledger into the throwaway (`ledger-replay.sh container`, section 3a; the printed row counts are post-replay) and fails with "the erasure-ledger replay failed" when no ledger object exists or the replay fails. A dump from before a release can be behind the checkout's migration number; that is normal and only printed. It prints no row contents (a failed load prints only the MySQL error numbers), and the downloaded dump sits in a private temp directory that is deleted on exit, including on failure. The throwaway is capped at 1 GB of memory (`--memory 1g --memory-swap 1g`, so an out-of-memory stays inside it and the live stack is safe) and labelled `plateandbar-restore-check=1`; a run killed earlier leaves its container behind, and the next run removes any it finds by that label first. A failed bucket listing is reported as "cannot list", distinct from "no backup object"; a failed download prints `restore-check FAILED` too. Needs about 1 GB free RAM and disk for twice the uncompressed dump; the stack may keep running.

0. **Owner**, before the next rehearsal: schedule the `ledger-upload.sh` cron (section 3a, step 1) on each VM and run it once by hand. Until it has uploaded at least one object, the rehearsal goes red with "no ledger object".
1. **Owner**, once: add the cron line to the crontab of the user that runs `backup.sh`, on each VM: `0 4 1 * * cd /opt/plateandbar/infra/staging && ./restore-check.sh >> "$HOME/plateandbar-restore-check.log" 2>&1` (04:00 UTC on the 1st, after the 03:15 backup). Or run `./restore-check.sh` by hand once a month.
2. **Owner**, optional but recommended: in Uptime Kuma add a **Push** monitor with a heartbeat interval of about 32 days and put its URL in `.env` as `RESTORE_HEARTBEAT_URL`, in single quotes (same rules as `BACKUP_HEARTBEAT_URL`, section 5). The script requests it only after a fully successful run, so a skipped or failed rehearsal alerts. A failing monitor never fails the check; the URL goes to curl on stdin.
3. Read the log (`tail -20 ~/plateandbar-restore-check.log`): it must end with `restore check ok: <object>`, and the row counts should look plausible (`users` not zero on production). A red run: read the line after `restore-check FAILED`; "older than 25 hours" means the nightly backup is not running (section 3), "did not load" means the newest dump is bad: take a fresh `./backup.sh` and re-run, and treat the older backups as suspect.
4. Record the run here (date, who, object name, result):

| Date | Who | Stack | Object | Result |
| --- | --- | --- | --- | --- |
| _not yet run against the real bucket_ | | | | |

## 4a. Production release (#685)

Production is a second stack on its own VM (set up with section 1, with its own `.env`; staging and production cannot share one VM because both need ports 80 and 443). Differences in the production `.env`: `API_HOST` is the production host, `BACKUP_S3_PREFIX=production`, real values for the secrets, `CORS_ALLOWED_ORIGINS` and `AUTH_COOKIE_ORIGINS` set to the exact web app origin (for example `https://app.example.com`; `AUTH_COOKIE_ORIGINS` empty refuses the web refresh cookie, so the web app cannot stay signed in), and `SYNC_MAX_RECORDS_PER_ACCOUNT` set to a number if you want a per-account storage cap (empty or 0 is no cap; the app must handle the 413 `account_full` first). Schedule the nightly backup (section 3) there too.

**Owner**, once: create the GitHub environment `production` with required reviewers and deployment tags `v*`, add its variables and secrets (`infra/README.md`, Production deploy), do the first start by hand (section 1, step 6), then set the repository variable `PRODUCTION_DEPLOY_ENABLED=true`.

Release: tag a commit that is on `main` (`git tag v1.2.3 <sha> && git push origin v1.2.3`; only `vMAJOR.MINOR.PATCH`). After you approve the `production` environment the workflow checks out the tag's verified commit on the VM and runs `infra/staging/release.sh v1.2.3 <sha>` (it fails if the tag was moved after the run started): backup, then `deploy.sh` (image `plateandbar-api:v1.2.3`, health poll through local Caddy for up to 5 minutes, automatic return to the previous `API_TAG` if it fails). A red run means either the backup failed (nothing was deployed; read the log, fix the bucket or credentials, re-run) or the deploy failed and was rolled back (the log shows the API's last 50 lines).

Rollback by hand = previous image tag: `docker image ls plateandbar-api`, set `API_TAG=<previous tag>` in the production `.env` (and `API_RELEASE=<that tag without the v>`), `docker compose up -d api`. Flyway migrations are forward-only: if the bad release added one, also restore the pre-release backup (section 4; the newest object in the `production/` prefix is the one taken just before that release) or ship a fix forward under a new tag. Re-running a workflow run for an old tag deploys that tag again, backing up first. If that re-run is unhealthy and the tag was already the deployed one, there is nothing to roll back to (previous and new tag are the same): use the manual rollback above.

Free tiers: nothing here adds a paid service; it reuses the bucket and VM limits recorded at the top of this file (checked 2026-10-12; the Oracle A1 numbers still need the owner's check).

## 5. Monitoring

Add an Uptime Kuma (MIT, self-hosted; the host is an **Owner** decision) HTTP(s) monitor on `https://<API_HOST>/api/v1/health` with an e-mail alert. `/health` answers 503 when the database is unreachable, so one monitor covers API and database. Check that the cron backup ran: the newest object in the bucket should be less than 25 hours old; the log is `~/plateandbar-backup.log` of the user whose crontab runs it. Better, let the job report in: add an Uptime Kuma **Push** monitor with a heartbeat interval of 25 hours and put its push URL in `.env` as `BACKUP_HEARTBEAT_URL`, **in single quotes** because the URL holds `&` (`BACKUP_HEARTBEAT_URL='https://<kuma-host>/api/push/<token>?status=up&msg=OK&ping='`; `.env` is sourced by the shell, unquoted `&` would run the line in the background and cut the URL). `backup.sh` requests it after each successful run (dump, upload and retention), also for the backup taken before a production release, and sends nothing when a run fails, so the monitor alerts on the missing ping. Empty or unset = off. A failing monitor never fails the backup. The URL is a secret: it goes to curl on stdin, never on a command line. The monthly restore rehearsal has its own push monitor (about 32 days, `RESTORE_HEARTBEAT_URL`, section 4).

### 5a. Install Uptime Kuma (#828)

Inert until you do this: nothing deploys `infra/monitoring/`, and no workflow starts it. Kuma must run on a different host from the one it watches.

1. **Owner:** pick the host (a second small Oracle ARM VM, or a machine you own that stays on), open 80, 443 and UDP 443, install Docker (section 1, steps 1 and 3), and point a DNS record for `KUMA_HOST` at it.
2. `git clone` the repository to `/opt/plateandbar`, then `cd /opt/plateandbar/infra/monitoring/uptime-kuma && cp .env.example .env && chmod 600 .env` and set `KUMA_HOST`.
3. `sudo /opt/plateandbar/infra/journald/install.sh` (as in section 1, step 6), then `docker compose up -d`. Memory is capped at 512 MB for Kuma and 64 MB for Caddy.
4. **Owner:** open `https://<KUMA_HOST>/` at once (the first visitor creates the admin account) and create the admin user, with a long password. Choose SQLite as the database when asked. Turn on two-factor authentication in Settings > Security.
5. **Owner:** add the notifier: Settings > Notifications > Setup Notification > Email (SMTP) with an SMTP account you already have (or a self-hosted ntfy; not the public ntfy.sh), tick "Default enabled" and "Apply on all existing monitors".
6. **Owner:** add every monitor in `infra/monitoring/MONITORS.md`, then put the push URLs in `infra/staging/.env` (`BACKUP_HEARTBEAT_URL`, `RESTORE_HEARTBEAT_URL`, `LEDGER_HEARTBEAT_URL`).
7. Test the alert once: pause the API monitor's target or point a temporary monitor at a closed port, and check the e-mail arrives.

### 5b. Install GlitchTip (#828)

Inert until you do this. It can run on its own host (recommended) or on the staging VM, see `infra/OBSERVABILITY.md` ("Where it runs") for memory and the port-80/443 catch.

1. **Owner:** host, ports and DNS for `GLITCHTIP_HOST` as in 5a steps 1 and 3. Set up SMTP (an account you already have).
2. `cd /opt/plateandbar/infra/monitoring/glitchtip && cp .env.example .env && chmod 600 .env`, then fill every value. Generate `SECRET_KEY` with `openssl rand -hex 32` and `POSTGRES_PASSWORD` with `openssl rand -hex 24` (hex only: the password sits inside a URL).
3. `sudo /opt/plateandbar/infra/journald/install.sh`, then start **only the database and GlitchTip**, not Caddy: `docker compose up -d postgres glitchtip`. `SERVER_ROLE=all_in_one` makes the first start run the migrations; wait for `docker compose logs glitchtip` to go quiet. Caddy stays down on purpose: GlitchTip keeps sign-up open until the first user exists, so a public start would let a stranger register first.
4. **Owner:** create your user from the command line: `docker compose exec glitchtip ./manage.py createsuperuser`. Then start Caddy, `docker compose up -d caddy`, open `https://<GLITCHTIP_HOST>/`, sign in, create one organisation (superusers can, although `ENABLE_ORGANIZATION_CREATION=false`), then two projects named `api` and `mobile`.
5. **Owner:** confirm registration is closed: in a private window open `https://<GLITCHTIP_HOST>/register`; it must not let a stranger create an account (`ENABLE_USER_REGISTRATION=false` closes it once a user exists). If it is open, stop Caddy (`docker compose stop caddy`) and report it; there is no UI switch for it.
6. **Owner, privacy checklist** (settings that live in the UI, not in the compose file): in each project's settings turn IP address scrubbing on if the option is offered (Caddy already strips `X-Forwarded-For`, so events carry only Caddy's own address); keep the project's "scrub data" options on. Send one worst-case test event from the app and the API and read it in GlitchTip: no IP address, no e-mail, no food or weight, no tokens (`infra/OBSERVABILITY.md`, "Error tracking rules"). Retention is 30 days, set in the compose file (`GLITCHTIP_RETENTION_DAYS`).
7. **Owner:** set the DSNs, never in the repository: the `api` project's DSN as `SENTRY_DSN` in `infra/staging/.env` on the API VM (then `docker compose up -d api`), the `mobile` project's DSN as the GitHub variable `EXPO_PUBLIC_SENTRY_DSN`, and `WEB_SENTRY_ORIGIN` in the same `.env` after `infra/scripts/check-sentry-origin.sh "$WEB_SENTRY_ORIGIN" "$EXPO_PUBLIC_SENTRY_DSN"` passes. Do this only after the privacy page and the Play data-safety answers are published (#748, #827).
8. Add the GlitchTip monitor from `infra/monitoring/MONITORS.md`.

Backup of the monitoring hosts: Kuma's monitors are re-creatable from the table, GlitchTip's data is 30 days of errors. Neither is backed up; losing them costs only history. Back up the two `.env` files with the rest of your secrets.

Update: change the pinned tag and digest in the compose file (`docker buildx imagetools inspect <image>:<tag>` prints the index digest and shows the `linux/arm64` entry; `infra/monitoring/test-config.sh` and the workflow check the pins), then `docker compose pull && docker compose up -d`. Rollback: put the previous tag and digest back. GlitchTip's migrations run forward-only on start, so keep the old image only until the new one has run cleanly.

## 6. Turning on the per-account record cap (#349, #667)

The cap is off by default (`SYNC_MAX_RECORDS_PER_ACCOUNT` empty). Do not set it until the mobile app handles 413 `account_full` (app PR #662). Order: (1) deploy a version that contains the recount (`RecordRecount`) with the cap still off; (2) set `SYNC_MAX_RECORDS_PER_ACCOUNT` (the contract suggests 200000) in `.env` and run `docker compose up -d api`; the restart starts the recount in the background, which re-checks every account's `sync_state.records` against the 16 tables, in short per-account transactions beside live traffic. (3) Check the log for `record recount done, counters corrected: N` (N is normally 0; the log has counts only). If the API restarts mid-run the next start repeats it; changing the limit needs the same restart, so it recounts then too. To switch the cap off, empty the variable and restart; nothing needs undoing.

## 7. Web app (#683)

The Expo web export is served by the same Caddy as the API (`infra/caddy/Caddyfile.web`); `.github/workflows/web-deploy.yml` publishes it. Off until you set `WEB_DEPLOY_ENABLED=true` (details in `infra/README.md`, Web app deploy). **Owner** steps, once per VM:

1. Choose `WEB_HOST` on the same site as `API_HOST` (`app.example.com` next to `api.example.com`; the refresh cookie is `SameSite=Strict`) and point its DNS record at the VM.
2. As the deploy user: `mkdir -p /opt/plateandbar/infra/staging/web` (Compose mounts it read-only at `/srv/web`; create it first or Docker makes it root-owned and rsync cannot write; if a `docker compose up -d` already ran and created it, fix it with `sudo chown <deploy-user> /opt/plateandbar/infra/staging/web`). Create a deploy-only SSH user or key limited to that directory (for example an rsync-restricted `authorized_keys` entry), separate from the `docker` user of the API deploy.
3. In `.env` set `WEB_HOST=app.example.com` (and `WEB_DIR` if the directory is elsewhere), add `https://app.example.com` to `CORS_ALLOWED_ORIGINS` and `AUTH_COOKIE_ORIGINS`, then `docker compose up -d` (recreates Caddy and the API) and watch `docker compose logs caddy` for the certificate. If the web build has `EXPO_PUBLIC_SENTRY_DSN`, also set `WEB_SENTRY_ORIGIN` to that DSN's origin and check the pair: `infra/scripts/check-sentry-origin.sh "$WEB_SENTRY_ORIGIN" "$EXPO_PUBLIC_SENTRY_DSN"` (a scheme-only or wildcard value would open `connect-src` to any host; a DSN with no origin is blocked by the CSP, so reports are dropped silently).
4. In GitHub, add the environment variables and secrets listed in `infra/README.md` to environments `staging` and `production`, then set `WEB_DEPLOY_ENABLED=true`.
5. Check: `curl -sI https://$WEB_HOST/` shows `cross-origin-opener-policy: same-origin`, `cross-origin-embedder-policy: require-corp` and `cache-control: no-cache`; a hashed file under `/_expo/static/` shows `immutable`.

A change to a Caddyfile is not picked up by `docker compose up -d` (the file is a bind mount): run `docker compose restart caddy`. Roll the web app back by re-running the workflow on the older commit or tag (Actions, Re-run) or by rsyncing a previous `dist/` into `WEB_ROOT`.
