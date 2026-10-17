#!/usr/bin/env bash
# Runs restore-check.sh against stub `docker` and `curl` that record every call: a fresh dump is loaded into a throwaway
# container (stack image tag, no network, no published port) and passes; a stale dump, a dump that fails to load, one
# without the Flyway history table, an invalid gzip and a missing object each exit non-zero; the temp dump and the
# container are removed in every case; no row content is printed; the heartbeat goes to curl on stdin and only on success;
# the live stack (docker compose) is never used. No Docker, network or bucket needed.
# Run from anywhere: infra/staging/test-restore-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/stack/infra/staging" "$tmp/tmpdir"
cp "$here/restore-check.sh" "$here/docker-compose.yml" "$tmp/stack/infra/staging/"
cp "$here/.env.example" "$tmp/stack/infra/staging/.env"
stack="$tmp/stack/infra/staging"

cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$1" in
  ps) printf '%b' "${STUB_STALE:-}" ;;
  run)
    if [[ " $* " == *" lsf "* ]]; then
      [ -z "${STUB_LSF_FAIL:-}" ] || { echo "rclone: access denied" >&2; exit 1; }
      printf '%b' "$STUB_LIST"
    elif [[ " $* " == *" cat "* ]]; then
      [ -z "${STUB_CAT_FAIL:-}" ] || exit 1
      if [ -n "${STUB_BAD_GZIP:-}" ]; then echo "not gzip"; else echo "INSERT INTO users VALUES ('secret-row-content');" | gzip; fi
    fi ;;
  exec)
    if [[ " $* " == *" mysqladmin "* ]]; then exit 0
    elif [[ " $* " == *" -N -B "* ]]; then
      q="$(cat)"
      case "$q" in
        *information_schema*) printf 'flyway_schema_history\nsync_state\nusers\nweights\n' | { [ -n "${STUB_NO_FLYWAY:-}" ] && grep -v flyway || cat; } | { [ -n "${STUB_NO_USERS:-}" ] && grep -v users || cat; } | { [ -n "${STUB_NO_SYNC:-}" ] && grep -v sync_state || cat; } ;;
        *MAX*) echo 9 ;;
        *COUNT*) echo 3 ;;
      esac
    else
      cat > /dev/null
      if [ -n "${STUB_LOAD_FAIL:-}" ]; then echo "ERROR 1062 (23000) at line 5: Duplicate entry 'secret-row-content' for key 'users.PRIMARY'" >&2; exit 1; fi
    fi ;;
esac
STUB
cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_CURL_LOG"
[[ " $* " != *" -K - "* ]] || cat >> "$STUB_CURL_LOG"
[ -z "${STUB_CURL_FAIL:-}" ] || exit 22
STUB
# make mktemp use a directory we can inspect afterwards
cat > "$tmp/bin/mktemp" <<'STUB'
#!/usr/bin/env bash
exec /usr/bin/mktemp -d "$TMPDIR_STUB/restore.XXXXXX"
STUB
chmod +x "$tmp/bin/docker" "$tmp/bin/curl" "$tmp/bin/mktemp"

fail() { echo "FAIL: $*"; cat "$STUB_LOG"; cat "$tmp/out" 2> /dev/null || true; exit 1; }
export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_CURL_LOG="$tmp/curl" TMPDIR_STUB="$tmp/tmpdir"

# object name for a dump taken $1 seconds ago (UTC)
obj() {
  local e=$(($(date -u +%s) - $1))
  local t; t="$(date -u -d "@$e" +%Y%m%dT%H%M%SZ 2> /dev/null || date -u -r "$e" +%Y%m%dT%H%M%SZ)"
  echo "plateandbar-$t.sql.gz"
}
fresh="$(obj 3600)"
older="$(obj 7200)"
run() { : > "$STUB_LOG"; : > "$STUB_CURL_LOG"; "$stack/restore-check.sh" > "$tmp/out" 2> "$tmp/err"; }
cleaned() {
  grep -q '^rm -fv plateandbar-restore-check-' "$STUB_LOG" || fail "the throwaway container was not removed (rm -fv)"
  [ -z "$(ls -A "$tmp/tmpdir")" ] || fail "the temporary dump directory was not deleted: $(ls "$tmp/tmpdir")"
}

# success: the newest object is used, loaded into a throwaway container, counts printed, no content, heartbeat off
export STUB_LIST="$older\n$fresh\nplateandbar-20200101T000000Z.sql.gz\nplateandbar-29990101T000000Z.sql.gz.partial\n"
run || fail "fresh dump: exited non-zero: $(cat "$tmp/err")"
grep -q " cat bk:plateandbar-backups/staging/$fresh\$" "$STUB_LOG" || fail "the newest object was not the one downloaded"
grep -Eq '^run -d --name plateandbar-restore-check-[0-9]+ --label plateandbar-restore-check=1 --memory 1g --memory-swap 1g --network none -e MYSQL_ROOT_PASSWORD -e MYSQL_DATABASE=plateandbar mysql:8\.4\.11$' "$STUB_LOG" || fail "throwaway container is not mysql:8.4.11, labelled, memory-capped, on no network, with the password passed by name"
# the password stays inside the container's shell: every `docker exec ... sh -c` line holds the literal variable, never a value
[ "$(grep -c '^exec .* sh -c ' "$STUB_LOG")" -ge 3 ] || fail "no exec sh -c calls to check"
# shellcheck disable=SC2016 # the literal text of the in-container variable
while IFS= read -r line; do
  case "$line" in *'MYSQL_PWD="$MYSQL_ROOT_PASSWORD"'*) ;; *) fail "the password is expanded into an exec argv: $line" ;; esac
done < <(grep '^exec .* sh -c ' "$STUB_LOG")
# stale throwaways are listed (by label) before the new one starts
[ "$(grep -n '^ps -aq --filter label=plateandbar-restore-check=1$' "$STUB_LOG" | head -1 | cut -d: -f1)" = 1 ] || fail "stale containers are not looked up first by label"
! grep -q '^rm -fv [a-f0-9]*$' "$STUB_LOG" || fail "removed a stale container when there was none"
! grep -Eq -- ' (-p|--publish)[ =]' "$STUB_LOG" || fail "a port is published"
! grep -q '^compose' "$STUB_LOG" || fail "the live stack (docker compose) was used"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"
grep -q 'age 1 h' "$tmp/out" || fail "age not printed"
grep -Eq '^  users[[:space:]]+3$' "$tmp/out" || fail "row count for users not printed"
grep -q 'V9' "$tmp/out" || fail "Flyway version not printed"
! grep -rq 'secret-row-content' "$tmp/out" "$tmp/err" || fail "row content was printed"
[ ! -s "$STUB_CURL_LOG" ] || fail "heartbeat sent although RESTORE_HEARTBEAT_URL is unset"
cleaned

# stale throwaways from killed runs are removed (with their volumes) at the start
STUB_STALE="deadbeef01\ndeadbeef02\n" run || fail "stale cleanup: exited non-zero"
grep -q '^rm -fv deadbeef01$' "$STUB_LOG" || fail "stale container 1 not removed"
grep -q '^rm -fv deadbeef02$' "$STUB_LOG" || fail "stale container 2 not removed"
[ "$(grep -n '^rm -fv deadbeef01$' "$STUB_LOG" | cut -d: -f1)" -lt "$(grep -n '^run -d ' "$STUB_LOG" | cut -d: -f1)" ] || fail "stale containers removed after the new one started"
cleaned
run

# heartbeat: once, on stdin, after success only
hb='https://kuma.test/api/push/tok3n-s3cret?status=up&msg=OK&ping='
echo "RESTORE_HEARTBEAT_URL='$hb'" >> "$stack/.env"
run || fail "heartbeat set: exited non-zero"
[ "$(grep -c '^curl ' "$STUB_CURL_LOG")" = 1 ] || fail "expected one heartbeat request"
grep -qF "url = \"$hb\"" "$STUB_CURL_LOG" || fail "heartbeat URL not given to curl on stdin"
! grep -q 'tok3n' <(grep '^curl ' "$STUB_CURL_LOG") || fail "heartbeat token on the curl command line"
! grep -q 'tok3n' "$STUB_LOG" || fail "heartbeat token on a docker command line"
STUB_CURL_FAIL=1 run || fail "a failing monitor failed the restore check"
grep -q 'heartbeat ping failed' "$tmp/err" || fail "no warning for a failed heartbeat"

# failures: non-zero, no heartbeat, cleaned up
must_fail() { # <description> <expected stderr text>, environment set by the caller
  if run; then fail "$1: exited 0"; fi
  grep -q "$2" "$tmp/err" || fail "$1: expected '$2' on stderr, got: $(cat "$tmp/err")"
  [ ! -s "$STUB_CURL_LOG" ] || fail "$1: heartbeat sent"
  ! grep -rq 'secret-row-content' "$tmp/out" "$tmp/err" || fail "$1: row content printed"
  cleaned
}
STUB_LIST="$(obj 93600)\n" must_fail "stale dump" "older than 25 hours"
STUB_LIST="" must_fail "no object" "no backup object"
STUB_LIST="$fresh\n" STUB_LSF_FAIL=1 must_fail "listing failed" "cannot list bk:plateandbar-backups/staging"
! grep -q 'no backup object' "$tmp/err" || fail "a failed listing was reported as a missing backup"
STUB_LIST="$fresh\n" STUB_CAT_FAIL=1 must_fail "download failed" "restore-check FAILED: the download of $fresh failed"
STUB_LIST="plateandbar-29990101T000000Z.sql.gz.partial\n" must_fail "only a partial upload" "no backup object"
STUB_LIST="$fresh\n" STUB_BAD_GZIP=1 must_fail "invalid gzip" "not a valid gzip"
STUB_LIST="$fresh\n" STUB_LOAD_FAIL=1 must_fail "failed load" "did not load"
grep -q 'mysql ERROR 1062' "$tmp/err" || fail "the error number is not printed"
STUB_LIST="$fresh\n" STUB_NO_FLYWAY=1 must_fail "no Flyway history" "flyway_schema_history is missing"
STUB_LIST="$fresh\n" STUB_NO_USERS=1 must_fail "no users table" "table users is missing"
STUB_LIST="$fresh\n" STUB_NO_SYNC=1 must_fail "no sync_state table" "table sync_state is missing"
[ "$(grep -c '^exec .* -N -B ' "$STUB_LOG")" -ge 1 ] || fail "no check ran"

echo "restore-check.sh tests passed"
