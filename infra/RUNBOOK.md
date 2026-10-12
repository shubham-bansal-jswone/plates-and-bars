# Staging runbook

Staging runs from `infra/staging/` on one VM: Caddy (HTTPS), the API and MySQL 8.4 in Docker Compose. This file covers set-up, backups, restore, rollback and monitoring. Nothing here is automated yet: no deploy workflow exists and no account has been created. Steps marked **Owner** need an account or a decision from Shubham.

## Free-tier limits (checked 2026-10-12)

- Cloudflare R2: free tier of 10 GB-month of Standard storage, 1 million Class A and 10 million Class B requests per month (developers.cloudflare.com/r2/pricing, fetched 2026-10-12). One dump a day kept 30 days stays far below that unless the compressed dump grows past roughly 300 MB.
- Oracle Cloud Always Free: the page (oracle.com/cloud/free) lists "Arm-based Ampere A1 Compute" and Block Volume, but the quota numbers load dynamically and were NOT confirmed on 2026-10-12. The commonly quoted figures (4 A1 OCPUs, 24 GB RAM and 200 GB block storage in total; idle instances can be reclaimed; A1 capacity in a region is sometimes unavailable) must be checked by **Owner** before creating the VM. This stack needs about 2 GB RAM.

Any S3-compatible bucket works: `backup.sh` only needs `BACKUP_S3_*` variables, so MinIO or another provider can replace R2 (the decided retention is 30 days either way).

## 1. VM set-up (once)

1. **Owner:** create the VM (Ubuntu 24.04 arm64 image) and open ingress TCP 80, 443 and UDP 443 plus SSH (22, ideally restricted to your IP) in the cloud security list. Also open the same ports in the VM firewall (`sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT`, `sudo iptables -I INPUT -p udp --dport 443 -j ACCEPT`, then persist with `netfilter-persistent save`); Oracle images ship with restrictive rules.
2. **Owner:** point the DNS record for `API_HOST` at the VM's public IP.
3. Install Docker Engine and the Compose plugin from Docker's apt repository (<https://docs.docker.com/engine/install/ubuntu/>).
4. `git clone` the repository to `/opt/plateandbar` (full history: the API needs `CONTENT_UPDATED_AT`).
5. `cd /opt/plateandbar/infra/staging && cp .env.example .env && chmod 600 .env`, then fill every value. `APP_RATELIMIT_TRUSTEDPROXIES` is fixed in `docker-compose.yml` to the pinned Compose subnet `172.28.0.0/24`, which is where Caddy connects from; see `infra/caddy/Caddyfile.api` and `infra/README.md` for why.
6. First start:
   ```
   sed -i "s/^API_TAG=.*/API_TAG=$(git rev-parse --short HEAD)/" .env
   CONTENT_UPDATED_AT="$(../../backend/scripts/content-updated-at.sh)" docker compose build api
   docker compose up -d
   curl -fsS https://$API_HOST/api/v1/health
   ```
   The first request makes Caddy fetch the certificate; it needs ports 80 and 443 reachable from the internet.

## 2. Update and rollback

Update: `git pull`, then repeat the three commands of step 6. Each build tags the image `plateandbar-api:<API_TAG>`, so earlier tags stay on the VM. `API_TAG` lives in `.env`, so any later plain `docker compose up -d` runs the same tag.

Rollback = previous image tag: `docker image ls plateandbar-api`, set `API_TAG=<previous tag>` in `.env`, then `docker compose up -d api` (no `build`). Flyway migrations are forward-only: if the bad release added a migration, restore the last backup (section 4) as well, or ship a fix forward.

Merge-to-`main` deploys and tagged production releases are not wired up; they need the VM and SSH credentials first (**Owner**), and then a workflow that runs these same commands.

## 3. Nightly backup

`backup.sh` streams `mysqldump --single-transaction` through gzip to the bucket as `<prefix>/plateandbar-<UTC timestamp>.sql.gz` (uploaded as `.partial`, renamed only if the dump succeeded) and then deletes objects older than 30 days. rclone runs from the pinned `rclone/rclone` image with the remote defined from environment variables, so no credentials are written to disk besides `.env`.

1. **Owner:** create a private bucket and an API token limited to it (R2: Object Read and Write on that bucket only). Put the endpoint, bucket and keys in `.env` (`BACKUP_S3_*`).
2. Run it once by hand: `./backup.sh`, then list the bucket to see the object.
3. Add to the VM's crontab (`crontab -e`): `15 3 * * * cd /opt/plateandbar/infra/staging && ./backup.sh >> "$HOME/plateandbar-backup.log" 2>&1`
4. The dump contains user data: keep the bucket private and do not widen the token. Enable the provider's encryption at rest if it is not on by default.

## 4. Restore

Use a scratch database first if you are only checking a backup.

1. Download a dump, from `infra/staging` (the first line loads `.env` into this shell; `lsf bk:<bucket>/<prefix>` in place of `copyto ...` lists objects):
   ```
   set -a; . ./.env; set +a
   export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other RCLONE_CONFIG_BK_NO_CHECK_BUCKET=true RCLONE_CONFIG_BK_ENDPOINT="$BACKUP_S3_ENDPOINT" RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
   docker run --rm -e RCLONE_CONFIG_BK_TYPE -e RCLONE_CONFIG_BK_PROVIDER -e RCLONE_CONFIG_BK_NO_CHECK_BUCKET -e RCLONE_CONFIG_BK_ENDPOINT -e RCLONE_CONFIG_BK_ACCESS_KEY_ID -e RCLONE_CONFIG_BK_SECRET_ACCESS_KEY -v "$PWD:/out" rclone/rclone:1.74.0 copyto "bk:$BACKUP_S3_BUCKET/<prefix>/<file>.sql.gz" /out/restore.sql.gz
   ```
2. Stop the API so nothing writes: `docker compose stop api`.
3. Recreate the database and load the dump:
   ```
   docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE plateandbar; CREATE DATABASE plateandbar"'
   gunzip -c restore.sql.gz | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot plateandbar'
   ```
   `DROP DATABASE` removes only the tables and data. The `MYSQL_USER` account and its grants on `plateandbar` live in the `mysql` system schema, so they still apply to the recreated database.
4. `docker compose start api` and check `curl -fsS https://$API_HOST/api/v1/health`.
5. Delete `restore.sql.gz` from the VM.

Rehearsal: the dump and restore commands (not the bucket transfer) were run on 2026-10-12 against a throwaway `mysql:8.4.11` container with a table and a trigger; the row count matched after restore. **Owner:** the full rehearsal against the real bucket, as required by #36, still has to be done once the bucket exists. Record the date here when done.

## 5. Monitoring

Add an Uptime Kuma (MIT, self-hosted; the host is an **Owner** decision) HTTP(s) monitor on `https://<API_HOST>/api/v1/health` with an e-mail alert. `/health` answers 503 when the database is unreachable, so one monitor covers API and database. Check that the cron backup ran: the newest object in the bucket should be less than 25 hours old; the log is `~/plateandbar-backup.log` of the user whose crontab runs it.
