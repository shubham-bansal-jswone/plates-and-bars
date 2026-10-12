#!/usr/bin/env bash
# Nightly MySQL backup: mysqldump | gzip, streamed to an S3-compatible bucket with rclone (MIT), then objects
# older than 30 days are deleted (the decided retention). Run from cron on the VM, see RUNBOOK.md:
#   15 3 * * * cd /opt/plateandbar/infra/staging && ./backup.sh >> "$HOME/plateandbar-backup.log" 2>&1
# Needs .env (see .env.example) and a running stack. The dump holds user data: keep the bucket private.
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck source=/dev/null
. ./.env
set +a
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
prefix="${BACKUP_S3_PREFIX:-staging}"
rclone_image="rclone/rclone:1.74.0"
# Remote "bk" is defined from the environment, so no config file with secrets exists on disk. The values are
# exported and passed by name (-e NAME), so the keys never appear on a command line (ps).
# NO_CHECK_BUCKET: an R2 token scoped to one bucket cannot create or check buckets.
export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other RCLONE_CONFIG_BK_NO_CHECK_BUCKET=true \
  RCLONE_CONFIG_BK_ENDPOINT="$BACKUP_S3_ENDPOINT" \
  RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
rclone() {
  docker run --rm -i -e RCLONE_CONFIG_BK_TYPE -e RCLONE_CONFIG_BK_PROVIDER -e RCLONE_CONFIG_BK_NO_CHECK_BUCKET \
    -e RCLONE_CONFIG_BK_ENDPOINT -e RCLONE_CONFIG_BK_ACCESS_KEY_ID -e RCLONE_CONFIG_BK_SECRET_ACCESS_KEY \
    "$rclone_image" "$@"
}

name="plateandbar-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
dest="bk:$BACKUP_S3_BUCKET/$prefix"
# Upload under a .partial name and rename only after mysqldump and gzip succeeded, so a failed dump never
# looks like a backup. The password is read inside the container from its own environment (not on a command line).
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF plateandbar' \
  | gzip -9 \
  | rclone rcat "$dest/$name.partial"
rclone moveto "$dest/$name.partial" "$dest/$name"
echo "backup ok: $name"

# 30-day retention (also removes stale .partial files)
rclone delete --min-age 30d "$dest"
