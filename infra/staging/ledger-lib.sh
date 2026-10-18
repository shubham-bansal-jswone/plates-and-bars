#!/usr/bin/env bash
# Shared by ledger-upload.sh and ledger-replay.sh (#853): sourced, not run. Loads .env, defines the rclone remote
# (the same credentials handling as backup.sh: values exported and passed by name, never on a command line) and the
# one line format of the erasure ledger. Must be sourced after `cd` to this directory.
# shellcheck source=/dev/null
export LC_ALL=C # grep, sort and awk behave the same on every host
set -a
. ./.env
set +a
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
prefix="${BACKUP_S3_PREFIX:-staging}"
rclone_image="rclone/rclone:1.74.0" # keep in step with backup.sh
export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other RCLONE_CONFIG_BK_NO_CHECK_BUCKET=true \
  RCLONE_CONFIG_BK_ENDPOINT="$BACKUP_S3_ENDPOINT" \
  RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
rclone() {
  docker run --rm -i -e RCLONE_CONFIG_BK_TYPE -e RCLONE_CONFIG_BK_PROVIDER -e RCLONE_CONFIG_BK_NO_CHECK_BUCKET \
    -e RCLONE_CONFIG_BK_ENDPOINT -e RCLONE_CONFIG_BK_ACCESS_KEY_ID -e RCLONE_CONFIG_BK_SECRET_ACCESS_KEY \
    "$rclone_image" "$@"
}

# Outside $prefix on purpose: backup.sh's 30-day retention deletes everything under bk:<bucket>/$prefix.
ledger_root="bk:$BACKUP_S3_BUCKET/erasure-ledger" # every VM prefix lives under it
ledger_dest="$ledger_root/$prefix"
# shellcheck disable=SC2034 # used by the scripts that source this file
ledger_retention_days=45 # 30-day backups plus margin (decided in #853); kept per UTC day, see ledger-upload.sh (#887)
# One valid line: ErasureLedger.ID, a tab, an ISO UTC time with optional fractional seconds. Keep in step with
# backend ErasureLedger.ID.
# shellcheck disable=SC2034
ledger_line=$'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\t[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z'

# Ledger objects: one per UTC day, erasures-YYYY-MM-DD.log, holding only that day's entries (#887). The 45-day
# snapshots ledger-YYYYMMDD.log written before #887 are still read (replay) until ledger-upload.sh has split them.
# shellcheck disable=SC2034
ledger_day_object='^erasures-[0-9]{4}-[0-9]{2}-[0-9]{2}\.log$'
# shellcheck disable=SC2034
ledger_old_object='^ledger-[0-9]{8}\.log$'

# Lists the ledger object names (both kinds). Prints them (one per line) and returns 0; a prefix with no objects is
# also 0 with no output (rclone v1.74.0 lists an empty prefix with exit 0; exit 3 means a missing bucket or a wrong
# endpoint, so it is a failure like any other non-zero exit). Any failure returns 1.
list_ledger_objects() {
  local out
  out="$(rclone lsf --files-only "$ledger_dest")" || return 1
  printf '%s' "$out" | { grep -E -e "$ledger_day_object" -e "$ledger_old_object" || true; }
}

# UTC date (YYYY-MM-DD) N days before now (GNU date, then BSD date)
utc_day_ago() {
  local e=$(($(date -u +%s) - $1 * 86400))
  date -u -d "@$e" +%Y-%m-%d 2> /dev/null || date -u -r "$e" +%Y-%m-%d
}
