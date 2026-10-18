#!/usr/bin/env bash
# Runs ledger-upload.sh and ledger-replay.sh (#853) against a stub `docker` that keeps a fake bucket in a directory and
# a fake database in two text files. Upload: the day's object is merged, never replaced by a shorter copy; entries and
# objects older than 45 days are pruned; the credentials are passed by name, never on a command line; a malformed line
# is skipped; a failed listing or a missing volume uploads nothing. Replay: a ledgered user (and its child rows) is
# gone after replay, in every object, with fractional seconds, in batches; a malformed or cut line is skipped and
# reported; a missing ledger fails and deletes nothing. No Docker, network or bucket needed.
# Run from anywhere: infra/staging/test-ledger.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin" "$tmp/stack"
cp "$here/ledger-lib.sh" "$here/ledger-upload.sh" "$here/ledger-replay.sh" "$tmp/stack/"
cp "$here/.env.example" "$tmp/stack/.env"

cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
bucket_path() { local p="${1#bk:plateandbar-backups/}"; echo "$STUB_BUCKET/$p"; }
case "$1" in
  volume) [ -z "${STUB_NO_VOLUME:-}" ] ;;
  compose | exec)
    # the fake database: users.txt (ids) and weights.txt (user_id per child row, deleted with the user: ON DELETE CASCADE)
    sql="$(cat)"
    echo "$sql" >> "$STUB_SQL"
    if [ -n "${STUB_DELETE_FAIL:-}" ]; then echo "ERROR 1451 (23000): Cannot delete 'secret-row-content'" >&2; exit 1; fi
    count=0
    while IFS= read -r line; do
      case "$line" in
        DELETE*)
          count=0
          for id in $(printf '%s' "$line" | grep -Eo '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}'); do
            if grep -qx "$id" "$STUB_DB/users.txt"; then count=$((count + 1)); fi
            grep -vx "$id" "$STUB_DB/users.txt" > "$STUB_DB/u.tmp" || true; mv "$STUB_DB/u.tmp" "$STUB_DB/users.txt"
            grep -vx "$id" "$STUB_DB/weights.txt" > "$STUB_DB/w.tmp" || true; mv "$STUB_DB/w.tmp" "$STUB_DB/weights.txt"
          done ;;
        SELECT*) echo "$count" ;;
      esac
    done <<< "$sql" ;;
  run)
    if [[ " $* " == *" --entrypoint sh "* ]]; then
      [ -z "${STUB_LOCAL_FAIL:-}" ] || exit 1
      [ ! -e "$STUB_LOCAL" ] || cat "$STUB_LOCAL"
      exit 0
    fi
    args=("$@")
    for i in "${!args[@]}"; do [[ "${args[$i]}" == rclone/rclone:* ]] && break; done
    cmd="${args[$((i + 1))]}"
    rest=("${args[@]:$((i + 2))}")
    case "$cmd" in
      lsf)
        [ -z "${STUB_LSF_FAIL:-}" ] || { echo "rclone: access denied" >&2; exit 1; }
        d="$(bucket_path "${rest[1]}")"
        [ -d "$d" ] || exit 3
        ls -1 "$d" ;;
      cat)
        [ -z "${STUB_CAT_FAIL:-}" ] || exit 1
        cat "$(bucket_path "${rest[0]}")" ;;
      rcat)
        f="$(bucket_path "${rest[0]}")"; mkdir -p "$(dirname "$f")"; cat > "$f" ;;
      moveto) mv "$(bucket_path "${rest[0]}")" "$(bucket_path "${rest[1]}")" ;;
      delete)
        n="${rest[1]%d}"
        find "$(bucket_path "${rest[2]}")" -type f -mtime "+$n" -delete ;;
    esac ;;
esac
STUB
cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_CURL_LOG"
[[ " $* " != *" -K - "* ]] || cat >> "$STUB_CURL_LOG"
[ -z "${STUB_CURL_FAIL:-}" ] || exit 22
STUB
chmod +x "$tmp/bin/docker" "$tmp/bin/curl"

export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_SQL="$tmp/sql" STUB_CURL_LOG="$tmp/curl" \
  STUB_BUCKET="$tmp/bucket" STUB_DB="$tmp/db" STUB_LOCAL="$tmp/local.log"
fail() { echo "FAIL: $*"; echo "--- docker log"; cat "$STUB_LOG"; echo "--- output"; cat "$tmp/out" 2> /dev/null || true; exit 1; }
dir="$tmp/bucket/erasure-ledger/staging"
today="$(date -u +%Y%m%d)"

# time N days ago, as the API writes it (whole seconds, UTC)
ago() {
  local e=$(($(date -u +%s) - $1 * 86400))
  date -u -d "@$e" +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || date -u -r "$e" +%Y-%m-%dT%H:%M:%SZ
}
# touch the object so its age is N days
age_object() {
  local e=$(($(date -u +%s) - $2 * 86400))
  touch -t "$(date -u -d "@$e" +%Y%m%d%H%M 2> /dev/null || date -u -r "$e" +%Y%m%d%H%M)" "$1"
}
tab=$'\t'
A=aaaaaaaa-0000-4000-8000-000000000001
B=bbbbbbbb-0000-4000-8000-000000000002
C=cccccccc-0000-4000-8000-000000000003
D=dddddddd-0000-4000-8000-000000000004
reset() {
  rm -rf "$tmp/bucket" "$tmp/db" "$tmp/local.log"
  mkdir -p "$tmp/db"
  printf '%s\n' "$A" "$B" "$C" "$D" > "$tmp/db/users.txt"
  printf '%s\n' "$A" "$A" "$B" "$C" > "$tmp/db/weights.txt"
  : > "$STUB_LOG"; : > "$STUB_SQL"; : > "$STUB_CURL_LOG"
}
up() { "$tmp/stack/ledger-upload.sh" > "$tmp/out" 2>&1; }
replay() { "$tmp/stack/ledger-replay.sh" "$@" > "$tmp/out" 2>&1; }
count() { grep -c -v '^$' "$1" || true; }

# the volume name the script reads is the one the compose file creates
grep -q '^name: plateandbar-staging$' "$here/docker-compose.yml" || fail "compose project name changed"
grep -q '^  erasure_ledger:$' "$here/docker-compose.yml" || fail "compose volume erasure_ledger is gone"
grep -q 'ledger_volume="plateandbar-staging_erasure_ledger"' "$here/ledger-upload.sh" || fail "wrong volume name"
grep -Eq '^rclone_image="rclone/rclone:[0-9]+\.[0-9]+\.[0-9]+"' "$here/ledger-lib.sh" || fail "rclone is not pinned"
[ "$(sed -n 's/^rclone_image="\(.*\)"$/\1/p' "$here/backup.sh")" = "$(sed -n 's/^rclone_image="\([^"]*\)".*$/\1/p' "$here/ledger-lib.sh")" ] || fail "rclone version differs from backup.sh"

echo "upload: first run uploads the ledger as a dated object, never on a command line, retention delete runs"
reset
printf '%s\t%s\n%s\t%s\n' "$A" "$(ago 1)" "$B" "$(ago 0)" > "$STUB_LOCAL"
up || fail "first upload exited non-zero"
obj="$dir/ledger-$today.log"
[ "$(count "$obj")" = 2 ] || fail "expected 2 entries in $obj"
[ ! -e "$obj.partial" ] || fail ".partial left behind"
grep -q ' delete --min-age 45d bk:plateandbar-backups/erasure-ledger/staging$' "$STUB_LOG" || fail "no 45-day delete"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"
for v in TYPE PROVIDER NO_CHECK_BUCKET ENDPOINT ACCESS_KEY_ID SECRET_ACCESS_KEY; do
  grep -q " -e RCLONE_CONFIG_BK_$v " "$STUB_LOG" || fail "rclone is not given RCLONE_CONFIG_BK_$v"
done
grep -q -- '-v plateandbar-staging_erasure_ledger:/ledger:ro' "$STUB_LOG" || fail "ledger volume not mounted read-only"

echo "upload: a longer bucket copy is never replaced by a shorter local file"
reset
mkdir -p "$dir"
printf '%s\t%s\n%s\t%s\n%s\t%s\n' "$A" "$(ago 3)" "$B" "$(ago 2)" "$C" "$(ago 1)" > "$obj"
printf '%s\t%s\n' "$A" "$(ago 3)" > "$STUB_LOCAL" # a shorter ledger (for example a fresh volume)
up || fail "upload exited non-zero"
[ "$(count "$obj")" = 3 ] || fail "bucket copy was shortened: $(count "$obj") lines"
grep -q "^$C" "$obj" || fail "an entry of the longer copy is gone"
: > "$STUB_LOG"; rm -f "$STUB_LOCAL" # no local ledger at all: the bucket copy stays, nothing is uploaded
up || fail "upload without a local ledger exited non-zero"
[ "$(count "$obj")" = 3 ] || fail "bucket copy shortened by an empty local ledger"
! grep -q ' rcat ' "$STUB_LOG" || fail "an unchanged ledger was uploaded again"
printf '%s\t%s\n' "$D" "$(ago 0)" > "$STUB_LOCAL" # a new entry is added to the longer copy
up || fail "upload with a new entry exited non-zero"
[ "$(count "$obj")" = 4 ] || fail "new entry not merged into the bucket copy"

echo "upload: entries and objects older than 45 days are pruned"
reset
mkdir -p "$dir"
printf '%s\t%s\n%s\t%s\n' "$A" "$(ago 46)" "$B" "$(ago 44)" > "$obj"
printf '%s\t%s\n%s\t%s\n' "$C" "$(ago 46)" "$D" "$(ago 44)" > "$STUB_LOCAL"
printf '%s\t%s\n' "$A" "$(ago 80)" > "$dir/ledger-20200101.log"; age_object "$dir/ledger-20200101.log" 46
printf '%s\t%s\n' "$B" "$(ago 50)" > "$dir/ledger-20200102.log.partial"; age_object "$dir/ledger-20200102.log.partial" 46
printf '%s\t%s\n' "$C" "$(ago 44)" > "$dir/ledger-20200103.log"; age_object "$dir/ledger-20200103.log" 44
up || fail "upload exited non-zero"
! grep -q "^$A" "$obj" || fail "an entry older than 45 days was uploaded"
! grep -q "^$C" "$obj" || fail "an entry older than 45 days was uploaded"
grep -q "^$B" "$obj" || fail "a recent entry was dropped"
grep -q "^$D" "$obj" || fail "a recent entry was dropped"
[ ! -e "$dir/ledger-20200101.log" ] || fail "an object older than 45 days was kept"
[ ! -e "$dir/ledger-20200102.log.partial" ] || fail "a stale .partial was kept"
[ -e "$dir/ledger-20200103.log" ] || fail "an object younger than 45 days was deleted"

echo "upload: a malformed local line is skipped and reported; no ledger yet uploads an empty object"
reset
mkdir -p "$dir"
printf '%s\t%s\n%s\n%s\t%s\n%s' "$A" "$(ago 1)" "${B:0:20}" "$C" "$(ago 1).5" "${D}${tab}2026-10" > "$STUB_LOCAL"
up || fail "upload with malformed lines exited non-zero"
[ "$(count "$obj")" = 1 ] || fail "expected only the valid line, got $(count "$obj")"
grep -q 'skipped 3 malformed' "$tmp/out" || fail "malformed lines not reported"
reset; rm -f "$STUB_LOCAL"
up || fail "upload with no ledger file exited non-zero"
[ -e "$obj" ] && [ ! -s "$obj" ] || fail "no empty object for an empty ledger"

echo "upload: failures upload nothing"
reset; printf '%s\t%s\n' "$A" "$(ago 1)" > "$STUB_LOCAL"
if STUB_NO_VOLUME=1 up; then fail "missing volume: exited 0"; fi
grep -q 'volume plateandbar-staging_erasure_ledger does not exist' "$tmp/out" || fail "missing volume not explained"
[ ! -e "$dir" ] || fail "uploaded without a volume"
if STUB_LOCAL_FAIL=1 up; then fail "unreadable ledger: exited 0"; fi
if STUB_LSF_FAIL=1 up; then fail "failed listing: exited 0"; fi
! grep -Eq ' (rcat|moveto|delete) ' "$STUB_LOG" || fail "a failed run wrote to the bucket"

echo "upload: heartbeat goes to curl on stdin, only after success"
reset; printf '%s\t%s\n' "$A" "$(ago 1)" > "$STUB_LOCAL"
echo "LEDGER_HEARTBEAT_URL='https://kuma.test/api/push/tok3n-s3cret?status=up&msg=OK&ping='" >> "$tmp/stack/.env"
up || fail "upload with heartbeat exited non-zero"
grep -qF 'url = "https://kuma.test/api/push/tok3n-s3cret' "$STUB_CURL_LOG" || fail "no heartbeat"
! grep '^curl ' "$STUB_CURL_LOG" | grep -q tok3n || fail "heartbeat token on the curl command line"
! grep -q tok3n "$STUB_LOG" || fail "heartbeat token on a docker command line"
: > "$STUB_CURL_LOG"
if STUB_LSF_FAIL=1 up; then fail "failed run exited 0"; fi
[ ! -s "$STUB_CURL_LOG" ] || fail "heartbeat sent after a failed run"
STUB_CURL_FAIL=1 up || fail "a failing monitor failed the upload"
sed -i.bak '/LEDGER_HEARTBEAT_URL/d' "$tmp/stack/.env"

echo "replay: a ledgered user leaves no rows, across objects, fractional seconds and batches"
reset; mkdir -p "$dir"
printf '%s\t%s\n' "$A" "$(ago 5)" > "$dir/ledger-20261001.log"
printf '%s\t%s.123456Z\n' "$C" "$(ago 2 | sed 's/Z$//')" > "$dir/ledger-20261002.log"
printf '%s\t%s\n%s\t%s' "$C" "$(ago 1)" "$A" "$(ago 1)" > "$dir/ledger-20261003.log" # duplicates, no final newline
replay live || fail "replay exited non-zero"
[ "$(cat "$tmp/db/users.txt" | tr '\n' ' ')" = "$B $D " ] || fail "users left: $(cat "$tmp/db/users.txt")"
[ "$(tr '\n' ' ' < "$tmp/db/weights.txt")" = "$B " ] || fail "child rows left: $(cat "$tmp/db/weights.txt")"
grep -q 'removed 2 user' "$tmp/out" || fail "wrong removed count"
grep -q '3 object(s), 4 line(s), 2 distinct user id(s), 0 malformed' "$tmp/out" || fail "wrong ledger summary"
grep -q '^compose exec -T mysql ' "$STUB_LOG" || fail "live mode did not use the stack's mysql"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"
! grep -Eq "$A|$C" "$tmp/out" || fail "a user id was printed"

reset; mkdir -p "$dir"; : > "$tmp/many"
for i in $(seq 1 1200); do printf '%08x-0000-4000-8000-000000000000\t%s\n' "$((i + 4096 * 65536))" "$(ago 1)" >> "$tmp/many"; done
cp "$tmp/many" "$dir/ledger-20261001.log"
cut -f1 "$tmp/many" > "$tmp/db/users.txt"; printf '%s\n' "$B" >> "$tmp/db/users.txt"
replay container plateandbar-restore-check-1 || fail "batched replay exited non-zero"
[ "$(cat "$tmp/db/users.txt")" = "$B" ] || fail "batched replay left $(count "$tmp/db/users.txt") users"
[ "$(grep -c '^DELETE' "$STUB_SQL")" = 3 ] || fail "expected 3 batches of at most 500"
grep -q '^exec -i plateandbar-restore-check-1 ' "$STUB_LOG" || fail "container mode did not use docker exec"

echo "replay: a malformed or cut line is skipped and reported"
reset; mkdir -p "$dir"
{
  printf '%s\t%s\n' "$A" "$(ago 1)"             # good
  printf '%s\n' "${B:0:18}"                       # cut inside the id
  printf '%s\t%s\n' "$B" "2026-10-1"              # cut inside the time
  printf '%s %s\n' "$B" "$(ago 1)"                # space, not a tab
  printf '%s\t%s\r\n' "$B" "$(ago 1)"             # CRLF
  printf '\n'                                     # blank: not counted
  printf 'junk\n'
  printf '%s\t%s\n' "$(printf "%s" "$C" | tr a-f A-F)" "$(ago 1)"           # upper-case id is not what the API writes
  printf '%s\t%s' "$D" "$(ago 1 | cut -c1-12)"    # cut final line, no newline
} > "$dir/ledger-20261001.log"
replay live || fail "replay with malformed lines exited non-zero"
grep -q '7 malformed line(s) skipped' "$tmp/out" || fail "malformed count not reported"
grep -q 'warning: 7 malformed' "$tmp/out" || fail "no warning"
[ "$(cat "$tmp/db/users.txt" | tr '\n' ' ')" = "$B $C $D " ] || fail "malformed lines were acted on: $(cat "$tmp/db/users.txt")"
! grep -q "${B:0:18}" "$tmp/out" || fail "a malformed line was printed"

echo "replay: an empty ledger is fine; a missing or unreadable one fails and deletes nothing"
reset; mkdir -p "$dir"; : > "$dir/ledger-20261001.log"
replay live || fail "an empty ledger failed"
grep -q 'nothing to delete' "$tmp/out" || fail "empty ledger not reported"
[ "$(count "$tmp/db/users.txt")" = 4 ] || fail "an empty ledger deleted users"
reset
if replay live; then fail "no ledger object: exited 0"; fi
grep -q 'no ledger object' "$tmp/out" || fail "missing ledger not explained"
reset; mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$dir/ledger-20261001.log"
if STUB_LSF_FAIL=1 replay live; then fail "failed listing: exited 0"; fi
if STUB_CAT_FAIL=1 replay live; then fail "failed download: exited 0"; fi
[ ! -s "$STUB_SQL" ] || fail "SQL ran although the ledger could not be read"
[ "$(count "$tmp/db/users.txt")" = 4 ] || fail "users deleted without a ledger"
mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$dir/ledger-20261001.log"; : > "$dir/ledger-20261001.log.partial"
reset; mkdir -p "$dir"; : > "$dir/ledger-20261001.log.partial"
if replay live; then fail "only a .partial object: exited 0"; fi

echo "replay: a failed delete fails and prints only the error number"
reset; mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$dir/ledger-20261001.log"
if STUB_DELETE_FAIL=1 replay live; then fail "failed delete: exited 0"; fi
grep -q 'mysql ERROR 1451' "$tmp/out" || fail "no error number"
! grep -q 'secret-row-content' "$tmp/out" || fail "row content printed"
if replay; then fail "no mode: exited 0"; fi
if replay container; then fail "container without a name: exited 0"; fi

echo "ledger tests passed"
