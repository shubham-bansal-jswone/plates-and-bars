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
chmod +x "$tmp/bin/docker"

fail() { echo "FAIL: $*"; cat "$STUB_LOG"; exit 1; }
export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log"

: > "$STUB_LOG"
"$tmp/stack/backup.sh" > /dev/null || fail "good dump: backup.sh exited non-zero"
grep -Eq ' rcat bk:plateandbar-backups/staging/plateandbar-[0-9]{8}T[0-9]{6}Z\.sql\.gz\.partial$' "$STUB_LOG" || fail "no .partial upload"
grep -q ' moveto .*\.partial bk:.*\.sql\.gz$' "$STUB_LOG" || fail "upload not renamed"
grep -q ' delete --min-age 30d bk:plateandbar-backups/staging$' "$STUB_LOG" || fail "no 30-day retention delete"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"

: > "$STUB_LOG"
if STUB_DUMP_FAIL=1 "$tmp/stack/backup.sh" > /dev/null 2>&1; then fail "failed dump: backup.sh exited 0"; fi
! grep -Eq ' (moveto|delete) ' "$STUB_LOG" || fail "failed dump was renamed or followed by a delete"

echo "backup.sh tests passed"
