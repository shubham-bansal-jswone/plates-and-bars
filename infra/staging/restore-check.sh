#!/usr/bin/env bash
# Monthly restore rehearsal (#829): downloads the newest nightly dump from the bucket, loads it into a THROWAWAY MySQL
# container (the image tag of the stack, no network, removed on exit), checks it and tears everything down. It never
# touches the live database (no `docker compose`). Prints the dump's age, each table with its row count and the latest
# Flyway version, never row contents. Exits non-zero if the dump is older than 25 hours, is not a valid gzip, fails to
# load, lacks the Flyway history table or the users / sync_state tables. Run from cron or by hand, see RUNBOOK.md section 4:
#   0 4 1 * * cd /opt/plateandbar/infra/staging && ./restore-check.sh >> "$HOME/plateandbar-restore-check.log" 2>&1
# It then replays the erasure ledger into the throwaway (ledger-replay.sh, #853), so the counts printed are post-replay,
# and fails when no ledger object exists (ledger-upload.sh not scheduled) or the replay fails.
# Optional RESTORE_HEARTBEAT_URL (an Uptime Kuma push URL with a heartbeat interval of about 32 days): requested with GET
# after a fully successful run, so a skipped or failed rehearsal makes the monitor alert. Unset = off.
# Needs .env (BACKUP_S3_*, see .env.example) and Docker; the stack itself need not be running. The dump holds user data:
# it lives in a private temp directory that is deleted on exit, including on failure.
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck source=/dev/null
. ./.env
set +a
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
prefix="${BACKUP_S3_PREFIX:-staging}"
rclone_image="rclone/rclone:1.74.0" # keep in step with backup.sh
max_age_seconds=$((25 * 3600))
wait_seconds="${RESTORE_WAIT_SECONDS:-180}"
# the same MySQL image as the stack
mysql_image="$(sed -n 's/^    image: \(mysql:[^ ]*\)$/\1/p' docker-compose.yml)"
[ -n "$mysql_image" ] || { echo "restore-check: no mysql image in docker-compose.yml" >&2; exit 1; }

export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other RCLONE_CONFIG_BK_NO_CHECK_BUCKET=true \
  RCLONE_CONFIG_BK_ENDPOINT="$BACKUP_S3_ENDPOINT" \
  RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
rclone() {
  docker run --rm -i -e RCLONE_CONFIG_BK_TYPE -e RCLONE_CONFIG_BK_PROVIDER -e RCLONE_CONFIG_BK_NO_CHECK_BUCKET \
    -e RCLONE_CONFIG_BK_ENDPOINT -e RCLONE_CONFIG_BK_ACCESS_KEY_ID -e RCLONE_CONFIG_BK_SECRET_ACCESS_KEY \
    "$rclone_image" "$@"
}

umask 077
work="$(mktemp -d)"
name="plateandbar-restore-check-$$"
cleanup() {
  docker rm -fv "$name" > /dev/null 2>&1 || true # -v: also the container's anonymous data volume
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

fail() { echo "restore-check FAILED: $*" >&2; exit 1; }

# A run killed by SIGKILL, the OOM killer or a reboot leaves its throwaway container (and its volume, which holds user
# data) behind; every throwaway carries this label, so the next run removes any it finds first.
label="plateandbar-restore-check=1"
stale="$(docker ps -aq --filter "label=$label")" || fail "cannot list containers"
for id in $stale; do
  echo "removing a stale throwaway container from an earlier run: $id"
  docker rm -fv "$id" > /dev/null 2>&1 || true
done

# newest object by name (the name holds the UTC time); .partial files never match
dest="bk:$BACKUP_S3_BUCKET/$prefix"
# a failed listing (bad key, bucket unreachable) is not the same as "no backup": say which
listing="$(rclone lsf --files-only "$dest")" || fail "cannot list $dest (check the BACKUP_S3_* values and the bucket); this is not a missing backup"
newest="$(printf '%s\n' "$listing" | grep -E '^plateandbar-[0-9]{8}T[0-9]{6}Z\.sql\.gz$' | sort | tail -1 || true)"
[ -n "$newest" ] || fail "no backup object under $dest"

stamp="${newest#plateandbar-}"; stamp="${stamp%.sql.gz}"
dump_epoch="$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2> /dev/null \
  || date -u -j -f '%Y%m%dT%H%M%SZ' "$stamp" +%s)"
age=$(($(date -u +%s) - dump_epoch))
echo "newest backup: $newest (age $((age / 3600)) h $((age % 3600 / 60)) min)"
[ "$age" -le "$max_age_seconds" ] || fail "the newest dump is older than 25 hours: the nightly backup is not running"

rclone cat "$dest/$newest" > "$work/dump.sql.gz" || fail "the download of $newest failed"
gzip -t "$work/dump.sql.gz" || fail "the dump is not a valid gzip file"

# Random root password, passed by name so it is on no command line. No published port and no network at all.
MYSQL_ROOT_PASSWORD="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MYSQL_ROOT_PASSWORD
# Memory-capped: next to the live stack (about 2 GB on the VM) an OOM must stay inside this container's cgroup.
docker run -d --name "$name" --label "$label" --memory 1g --memory-swap 1g --network none -e MYSQL_ROOT_PASSWORD -e MYSQL_DATABASE=plateandbar "$mysql_image" > /dev/null
sql() { docker exec -i "$name" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B plateandbar'; }

ready=0
for ((i = 0; i < wait_seconds; i += 2)); do
  if docker exec "$name" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -h 127.0.0.1 -uroot --silent' > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || fail "the throwaway MySQL did not start within ${wait_seconds}s"

# mysql error text can quote row values (duplicate entry): print only the error numbers
if ! gunzip -c "$work/dump.sql.gz" | docker exec -i "$name" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot plateandbar' > /dev/null 2> "$work/load.err"; then
  sed -n 's/^ERROR \([0-9]*\).*/mysql ERROR \1/p' "$work/load.err" >&2
  fail "the dump did not load"
fi

tables="$(echo "SELECT table_name FROM information_schema.tables WHERE table_schema = 'plateandbar' AND table_type = 'BASE TABLE' ORDER BY table_name" | sql)"
for t in flyway_schema_history users sync_state; do
  printf '%s\n' "$tables" | grep -qx "$t" || fail "table $t is missing from the restored dump"
done
# Erasure ledger (#853): accounts deleted after this dump was taken must be gone before anything reads it
./ledger-replay.sh container "$name" || fail "the erasure-ledger replay failed"
echo "tables and row counts:"
while IFS= read -r t; do
  [[ "$t" =~ ^[a-z0-9_]+$ ]] || fail "unexpected table name"
  printf '  %s\t%s\n' "$t" "$(echo "SELECT COUNT(*) FROM \`$t\`" | sql)"
done <<< "$tables"
version="$(echo "SELECT COALESCE(MAX(CAST(version AS UNSIGNED)), 0) FROM flyway_schema_history WHERE success = 1" | sql)"
[ "$version" -ge 1 ] 2> /dev/null || fail "the Flyway history has no successful migration"
echo "latest Flyway migration in the dump: V$version"
latest=0
for f in ../../backend/src/main/resources/db/migration/V*__*.sql; do
  [ -e "$f" ] || continue
  n="${f##*/V}"; n="${n%%__*}"
  if [ "$n" -gt "$latest" ]; then latest="$n"; fi
done
if [ "$latest" -gt 0 ]; then echo "latest migration in this checkout: V$latest"; fi
echo "restore check ok: $newest"

# Heartbeat. The URL holds a secret token, so it goes to curl on stdin (-K -), not on the command line (ps).
if [ -n "${RESTORE_HEARTBEAT_URL:-}" ]; then
  printf 'url = "%s"\n' "$RESTORE_HEARTBEAT_URL" | curl -fsS -m 10 --retry 3 -o /dev/null -K - \
    || echo "warning: heartbeat ping failed (the restore check itself succeeded)" >&2
fi
