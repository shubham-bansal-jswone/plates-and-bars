#!/usr/bin/env bash
# Runs backup.sh against a stub `docker` that records every call: a good dump is uploaded, renamed and followed by
# the 30-day retention delete; a failed dump exits non-zero and is neither renamed nor followed by a delete.
# No Docker, network or bucket needed. Run from anywhere: infra/staging/test-backup.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin" "$tmp/stack"
cp "$here/backup.sh" "$tmp/stack/"
cp "$here/.env.example" "$tmp/stack/.env"
cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [ "$1" = compose ]; then
  [ -z "${STUB_DUMP_FAIL:-}" ] || exit 1
  echo "-- dump"
elif [[ " $* " == *" rcat "* ]]; then
  cat > /dev/null
fi
STUB
# curl stub: records its arguments and the config read from stdin (-K -); STUB_CURL_FAIL makes it fail
cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_CURL_LOG"
[[ " $* " != *" -K - "* ]] || cat >> "$STUB_CURL_LOG"
[ -z "${STUB_CURL_FAIL:-}" ] || exit 22
STUB
chmod +x "$tmp/bin/docker" "$tmp/bin/curl"

fail() { echo "FAIL: $*"; cat "$STUB_LOG"; exit 1; }
export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_CURL_LOG="$tmp/curl"

: > "$STUB_LOG"
: > "$STUB_CURL_LOG"
"$tmp/stack/backup.sh" > /dev/null || fail "good dump: backup.sh exited non-zero"
[ ! -s "$STUB_CURL_LOG" ] || fail "heartbeat sent although BACKUP_HEARTBEAT_URL is unset: $(cat "$STUB_CURL_LOG")"
grep -Eq ' rcat bk:plateandbar-backups/staging/plateandbar-[0-9]{8}T[0-9]{6}Z\.sql\.gz\.partial$' "$STUB_LOG" || fail "no .partial upload"
grep -q ' moveto .*\.partial bk:.*\.sql\.gz$' "$STUB_LOG" || fail "upload not renamed"
grep -q ' delete --min-age 30d bk:plateandbar-backups/staging$' "$STUB_LOG" || fail "no 30-day retention delete"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"
for v in TYPE PROVIDER NO_CHECK_BUCKET ENDPOINT ACCESS_KEY_ID SECRET_ACCESS_KEY; do
  grep -q " -e RCLONE_CONFIG_BK_$v " "$STUB_LOG" || fail "rclone is not given RCLONE_CONFIG_BK_$v"
done
grep -q 'RCLONE_CONFIG_BK_NO_CHECK_BUCKET=true' "$tmp/stack/backup.sh" || fail "NO_CHECK_BUCKET is not true"
grep -q 'mysqldump .*--single-transaction' "$STUB_LOG" || fail "mysqldump without --single-transaction"

: > "$STUB_LOG"
if STUB_DUMP_FAIL=1 "$tmp/stack/backup.sh" > /dev/null 2>&1; then fail "failed dump: backup.sh exited 0"; fi
! grep -Eq ' (moveto|delete) ' "$STUB_LOG" || fail "failed dump was renamed or followed by a delete"

# heartbeat: with the URL set it is requested once after success, from stdin (not on a command line or the docker log)
hb='https://kuma.test/api/push/tok3n-s3cret?status=up'
echo "BACKUP_HEARTBEAT_URL=$hb" >> "$tmp/stack/.env"
: > "$STUB_LOG"; : > "$STUB_CURL_LOG"
"$tmp/stack/backup.sh" > /dev/null || fail "heartbeat set: backup.sh exited non-zero"
[ "$(grep -c '^curl ' "$STUB_CURL_LOG")" = 1 ] || fail "expected one heartbeat request: $(cat "$STUB_CURL_LOG")"
grep -qF "url = \"$hb\"" "$STUB_CURL_LOG" || fail "heartbeat URL not given to curl on stdin"
! grep -q 'tok3n' <(grep '^curl ' "$STUB_CURL_LOG") || fail "heartbeat token on the curl command line"
! grep -q 'tok3n' "$STUB_LOG" || fail "heartbeat token on a docker command line"

# a failing monitor does not fail a good backup
: > "$STUB_LOG"; : > "$STUB_CURL_LOG"
STUB_CURL_FAIL=1 "$tmp/stack/backup.sh" > /dev/null 2> "$tmp/err" || fail "failing heartbeat made the backup fail"
grep -q 'heartbeat ping failed' "$tmp/err" || fail "no warning for a failed heartbeat"
! grep -q 'tok3n' "$tmp/err" || fail "heartbeat token printed on failure"

# a failed dump sends no heartbeat (the missing ping is the alert)
: > "$STUB_LOG"; : > "$STUB_CURL_LOG"
if STUB_DUMP_FAIL=1 "$tmp/stack/backup.sh" > /dev/null 2>&1; then fail "failed dump with heartbeat: exited 0"; fi
[ ! -s "$STUB_CURL_LOG" ] || fail "heartbeat sent after a failed dump"

echo "backup.sh tests passed"
