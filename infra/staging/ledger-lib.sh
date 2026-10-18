#!/usr/bin/env bash
# Shared by ledger-upload.sh and ledger-replay.sh (#853): sourced, not run. Loads .env, defines the rclone remote
# (the same credentials handling as backup.sh: values exported and passed by name, never on a command line) and the
# one line format of the erasure ledger. Must be sourced after `cd` to this directory.
# shellcheck source=/dev/null
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
ledger_dest="bk:$BACKUP_S3_BUCKET/erasure-ledger/$prefix"
# shellcheck disable=SC2034 # used by the scripts that source this file
ledger_retention_days=45 # 30-day backups plus margin (decided in #853)
# One valid line: ErasureLedger.ID, a tab, an ISO UTC time with optional fractional seconds. Keep in step with
# backend ErasureLedger.ID.
# shellcheck disable=SC2034
ledger_line=$'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\t[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z'

# Lists the ledger object names. Prints them (one per line) and returns 0; a prefix with no objects is also 0 with no
# output (S3 has no directories, but rclone may report "directory not found", exit code 3). Any other failure returns 1.
list_ledger_objects() {
  local rc=0 out
  out="$(rclone lsf --files-only "$ledger_dest")" || rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then return 1; fi
  printf '%s' "$out" | { grep -E '^ledger-[0-9]{8}\.log$' || true; }
}
