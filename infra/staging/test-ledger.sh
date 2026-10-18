#!/usr/bin/env bash
# Runs ledger-upload.sh and ledger-replay.sh (#853, #887) against a stub `docker` that keeps a fake bucket in a
# directory, the ledger volume in another (the scripts' shell snippets run against it), and a fake database in text
# files. Upload: one object per UTC day holding only that day's entries; a day's object is merged, never replaced by
# a shorter copy; local day files and day objects are deleted exactly past 45 days (kept versus deleted at the
# boundary); the single erasures.log of the first version and the old 45-day snapshot objects are split per day; the
# credentials are passed by name, never on a command line; a malformed line is skipped; a failed listing or a missing
# volume uploads nothing. Replay: a ledgered user (and its child rows) is gone after replay, across several day
# objects, with fractional seconds, in batches; a malformed or cut line is skipped and reported; a missing ledger fails
# and deletes nothing. No Docker, network or bucket needed.
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
    if [ "$1 $2" = "compose ps" ]; then [ -z "${STUB_API_RUNNING:-}" ] || echo "abc123api"; exit 0; fi
    # the fake database: users.txt (ids), weights.txt (user_id per child row, deleted with the user: ON DELETE CASCADE),
    # user_emails.txt (id TAB email: users.email and auth_identities), codes.txt and failures.txt (email_sign_in_codes and
    # email_verify_failures: one e-mail per row, NO foreign key, deleted only by the joins on the user's e-mail)
    sql="$(cat)"
    echo "$sql" >> "$STUB_SQL"
    if [ -n "${STUB_DELETE_FAIL:-}" ]; then echo "ERROR 1451 (23000): Cannot delete 'secret-row-content'" >&2; exit 1; fi
    count=0
    while IFS= read -r line; do
      case "$line" in
        "DELETE c FROM email_sign_in_codes"* | "DELETE f FROM email_verify_failures"*)
          case "$line" in *email_sign_in_codes*) t=codes ;; *) t=failures ;; esac
          for id in $(printf '%s' "$line" | grep -Eo '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}'); do
            for e in $(awk -F'\t' -v i="$id" '$1 == i {print $2}' "$STUB_DB/user_emails.txt"); do
              grep -vx "$e" "$STUB_DB/$t.txt" > "$STUB_DB/e.tmp" || true; mv "$STUB_DB/e.tmp" "$STUB_DB/$t.txt"
            done
          done ;;
        "DELETE FROM users"*)
          count=0
          for id in $(printf '%s' "$line" | grep -Eo '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}'); do
            if grep -qx "$id" "$STUB_DB/users.txt"; then count=$((count + 1)); fi
            grep -vx "$id" "$STUB_DB/users.txt" > "$STUB_DB/u.tmp" || true; mv "$STUB_DB/u.tmp" "$STUB_DB/users.txt"
            grep -vx "$id" "$STUB_DB/weights.txt" > "$STUB_DB/w.tmp" || true; mv "$STUB_DB/w.tmp" "$STUB_DB/weights.txt"
            grep -v "^$id	" "$STUB_DB/user_emails.txt" > "$STUB_DB/m.tmp" || true; mv "$STUB_DB/m.tmp" "$STUB_DB/user_emails.txt"
          done ;;
        SELECT*) echo "$count" ;;
      esac
    done <<< "$sql" ;;
  run)
    args=("$@")
    if [[ " $* " == *" --entrypoint sh "* ]]; then
      # the snippet runs in this shell against $STUB_VOLUME (the volume mounted at /ledger)
      [ -z "${STUB_VOLUME_FAIL:-}" ] || exit 1
      for i in "${!args[@]}"; do [ "${args[$i]}" = -c ] && break; done
      script="${args[$((i + 1))]}"
      umask 022 # what a busybox shell in the container starts with, whatever the caller's umask
      exec sh -c "${script//\/ledger/$STUB_VOLUME}" "${args[@]:$((i + 2))}"
    fi
    out=""
    for i in "${!args[@]}"; do [ "${args[$i]}" = -v ] && out="${args[$((i + 1))]%:/out}"; done
    for i in "${!args[@]}"; do [[ "${args[$i]}" == rclone/rclone:* ]] && break; done
    cmd="${args[$((i + 1))]}"
    rest=("${args[@]:$((i + 2))}")
    case "$cmd" in
      lsf)
        [ -z "${STUB_LSF_FAIL:-}" ] || { echo "rclone: access denied" >&2; exit "$STUB_LSF_FAIL"; }
        if [ "${rest[0]}" = -R ]; then
          [ -z "${STUB_LSF_R_FAIL:-}" ] || exit 1 # lsf -R --files-only <root>: every file below, relative
          d="$(bucket_path "${rest[2]}")"
          [ -d "$d" ] && (cd "$d" && find . -type f | sed 's#^\./##')
          exit 0
        fi
        d="$(bucket_path "${rest[1]}")"
        [ -d "$d" ] || exit 0 # rclone v1.74.0: an empty prefix lists nothing, exit 0
        ls -1 "$d" ;;
      copy) # copy <remote dir> /out --include <glob>...
        [ -z "${STUB_CAT_FAIL:-}" ] || exit 1
        for f in "$(bucket_path "${rest[0]}")"/*; do
          for j in "${!rest[@]}"; do
            if [ "${rest[$j]}" = --include ] && [[ "${f##*/}" == ${rest[$((j + 1))]} ]]; then cp "$f" "$out/"; fi
          done
        done ;;
      cat)
        [ -z "${STUB_CAT_FAIL:-}" ] || exit 1
        cat "$(bucket_path "${rest[0]}")" ;;
      rcat)
        f="$(bucket_path "${rest[0]}")"; mkdir -p "$(dirname "$f")"; cat > "$f" ;;
      moveto) mv "$(bucket_path "${rest[0]}")" "$(bucket_path "${rest[1]}")" ;;
      deletefile) rm "$(bucket_path "${rest[0]}")" ;;
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
  STUB_BUCKET="$tmp/bucket" STUB_DB="$tmp/db" STUB_VOLUME="$tmp/volume"
fail() { echo "FAIL: $*"; echo "--- docker log"; cat "$STUB_LOG"; echo "--- output"; cat "$tmp/out" 2> /dev/null || true; exit 1; }
dir="$tmp/bucket/erasure-ledger/staging"
vol="$STUB_VOLUME"

# time N days ago, as the API writes it (whole seconds, UTC), and its UTC day; from one fixed "now" so that a value
# written and the value compared later are the same
now="$(date -u +%s)"
ago() {
  local e=$((now - $1 * 86400))
  date -u -d "@$e" +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || date -u -r "$e" +%Y-%m-%dT%H:%M:%SZ
}
day() { ago "$1" | cut -c1-10; }
# the API's day file and the bucket's day object of the day N days ago
vfile() { echo "$vol/erasures-$(day "$1").log"; }
bobj() { echo "$dir/erasures-$(day "$1").log"; }
# touch the object so its age is N days
age_object() {
  local e=$(($(date -u +%s) - $2 * 86400))
  touch -t "$(date -u -d "@$e" +%Y%m%d%H%M 2> /dev/null || date -u -r "$e" +%Y%m%d%H%M)" "$1"
}
# every line of a day object belongs to the day in its name
only_its_day() {
  local d="${1##*/erasures-}"
  awk -F'\t' -v d="${d%.log}" 'substr($2, 1, 10) != d { bad = 1 } END { exit bad }' "$1"
}
tab=$'\t'
A=aaaaaaaa-0000-4000-8000-000000000001
B=bbbbbbbb-0000-4000-8000-000000000002
C=cccccccc-0000-4000-8000-000000000003
D=dddddddd-0000-4000-8000-000000000004
reset() {
  rm -rf "$tmp/bucket" "$tmp/db" "$tmp/volume"
  mkdir -p "$tmp/db" "$tmp/volume"
  printf '%s\n' "$A" "$B" "$C" "$D" > "$tmp/db/users.txt"
  printf '%s\n' "$A" "$A" "$B" "$C" > "$tmp/db/weights.txt"
  printf '%s\t%s\n' "$A" a@x.test "$B" b@x.test "$C" c@x.test "$D" d@x.test > "$tmp/db/user_emails.txt"
  printf '%s\n' a@x.test b@x.test c@x.test d@x.test > "$tmp/db/codes.txt"
  printf '%s\n' a@x.test a@x.test b@x.test c@x.test > "$tmp/db/failures.txt"
  : > "$STUB_LOG"; : > "$STUB_SQL"; : > "$STUB_CURL_LOG"
}
up() { "$tmp/stack/ledger-upload.sh" > "$tmp/out" 2>&1; }
replay() { "$tmp/stack/ledger-replay.sh" "$@" > "$tmp/out" 2>&1; }
count() { grep -c -v '^$' "$1" || true; }
objects() { find "$dir" -type f 2> /dev/null | wc -l | tr -d ' '; }

# the volume name the script reads is the one the compose file creates
grep -q '^name: plateandbar-staging$' "$here/docker-compose.yml" || fail "compose project name changed"
grep -q '^  erasure_ledger:$' "$here/docker-compose.yml" || fail "compose volume erasure_ledger is gone"
grep -q 'ledger_volume="plateandbar-staging_erasure_ledger"' "$here/ledger-upload.sh" || fail "wrong volume name"
grep -Eq '^rclone_image="rclone/rclone:[0-9]+\.[0-9]+\.[0-9]+"' "$here/ledger-lib.sh" || fail "rclone is not pinned"
[ "$(sed -n 's/^rclone_image="\(.*\)"$/\1/p' "$here/backup.sh")" = "$(sed -n 's/^rclone_image="\([^"]*\)".*$/\1/p' "$here/ledger-lib.sh")" ] || fail "rclone version differs from backup.sh"
# what the uploader writes on the volume belongs to the API's user
grep -q 'useradd --system --uid 10001 app' "$here/../../backend/Dockerfile" || fail "the API's uid changed"
grep -q '^app_user="10001:10001"$' "$here/ledger-upload.sh" || fail "the uploader does not write as the API's user"

echo "upload: one object per UTC day holding only that day, never on a command line, retention delete runs"
reset
printf '%s\t%s\n' "$A" "$(ago 1)" > "$(vfile 1)"
printf '%s\t%s\n%s\t%s\n' "$B" "$(ago 0)" "$C" "$(ago 2)" > "$(vfile 0)" # C is in the wrong file: it goes to its own day
up || fail "first upload exited non-zero"
[ "$(objects)" = 3 ] || fail "expected 3 day objects, got: $(ls "$dir")"
[ "$(cat "$(bobj 0)")" = "$B$tab$(ago 0)" ] || fail "today's object: $(cat "$(bobj 0)")"
[ "$(cat "$(bobj 1)")" = "$A$tab$(ago 1)" ] || fail "yesterday's object: $(cat "$(bobj 1)")"
[ "$(cat "$(bobj 2)")" = "$C$tab$(ago 2)" ] || fail "an entry was not put in the object of its day"
for o in "$dir"/*; do only_its_day "$o" || fail "$o holds another day's entry"; done
[ -z "$(find "$dir" -name '*partial*')" ] || fail ".partial left behind"
grep -Eq ' rcat bk:plateandbar-backups/erasure-ledger/staging/erasures-[0-9]{4}-[0-9]{2}-[0-9]{2}\.log\.partial\.[0-9]+$' "$STUB_LOG" || fail "the .partial name has no per-run suffix"
grep -q ' delete --min-age 45d bk:plateandbar-backups/erasure-ledger$' "$STUB_LOG" || fail "no 45-day delete"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"
for v in TYPE PROVIDER NO_CHECK_BUCKET ENDPOINT ACCESS_KEY_ID SECRET_ACCESS_KEY; do
  grep -q " -e RCLONE_CONFIG_BK_$v " "$STUB_LOG" || fail "rclone is not given RCLONE_CONFIG_BK_$v"
done
grep -q -- '--user 10001:10001 -v plateandbar-staging_erasure_ledger:/ledger:ro ' "$STUB_LOG" || fail "ledger volume not read read-only"
[ "$(cat "$(vfile 0)")" = "$B$tab$(ago 0)"$'\n'"$C$tab$(ago 2)" ] || fail "the local day file was changed"
: > "$STUB_LOG"
up || fail "second upload exited non-zero"
! grep -q ' rcat ' "$STUB_LOG" || fail "unchanged day objects were uploaded again"
grep -q 'ledger unchanged: 3 day object(s)' "$tmp/out" || fail "unchanged objects not reported"

echo "upload: a longer bucket copy is never replaced by a shorter local file"
reset
mkdir -p "$dir"
printf '%s\t%s\n%s\t%s\n%s\t%s\n' "$A" "$(ago 0)" "$B" "$(ago 0)" "$C" "$(ago 0)" > "$(bobj 0)"
printf '%s\t%s\n' "$A" "$(ago 0)" > "$(vfile 0)" # a shorter ledger (for example a fresh volume)
up || fail "upload exited non-zero"
[ "$(count "$(bobj 0)")" = 3 ] || fail "bucket copy was shortened: $(count "$(bobj 0)") lines"
grep -q "^$C" "$(bobj 0)" || fail "an entry of the longer copy is gone"
: > "$STUB_LOG"; rm "$(vfile 0)" # no local ledger at all: the bucket copy stays, nothing is uploaded
up || fail "upload without a local ledger exited non-zero"
[ "$(count "$(bobj 0)")" = 3 ] || fail "bucket copy shortened by an empty local ledger"
! grep -q ' rcat ' "$STUB_LOG" || fail "an unchanged ledger was uploaded again"
printf '%s\t%s\n' "$D" "$(ago 0)" > "$(vfile 0)" # a new entry is added to the longer copy
up || fail "upload with a new entry exited non-zero"
[ "$(count "$(bobj 0)")" = 4 ] || fail "new entry not merged into the bucket copy"

echo "upload: local day files are kept exactly 45 days, and deleted even when the bucket cannot be reached"
reset
for n in 44 45 46 47; do printf '%s\t%s\n' "$A" "$(ago "$n")" > "$(vfile "$n")"; done
up || fail "upload exited non-zero"
[ -e "$(vfile 44)" ] || fail "the day file 44 days back was deleted"
[ -e "$(vfile 45)" ] || fail "the day file 45 days back was deleted"
[ ! -e "$(vfile 46)" ] || fail "the day file 46 days back was kept"
[ ! -e "$(vfile 47)" ] || fail "the day file 47 days back was kept"
grep -q 'deleted 2 local day file(s) more than 45 days old' "$tmp/out" || fail "the deletion was not reported"
grep -Eq -- "--user 10001:10001 -v plateandbar-staging_erasure_ledger:/ledger --entrypoint sh rclone/rclone:[0-9.]+ -c .*rm -f .* sh erasures-$(day 47)\.log erasures-$(day 46)\.log$" "$STUB_LOG" \
  || fail "the day files were not deleted by name as the API's user"
[ -e "$(bobj 44)" ] || fail "the day 44 days back was not uploaded"
[ ! -e "$(bobj 45)" ] || fail "the oldest kept day was uploaded (its object could have aged out already)"
[ ! -e "$(bobj 46)" ] || fail "a day past retention was uploaded"
reset
printf '%s\t%s\n' "$A" "$(ago 46)" > "$(vfile 46)"
if STUB_LSF_FAIL=1 up; then fail "failed listing: exited 0"; fi
[ ! -e "$(vfile 46)" ] || fail "a day file past retention was kept because the bucket failed"

echo "upload: day objects are kept exactly 45 days by their day, and any object older than 45 days goes"
reset; mkdir -p "$dir"
for n in 44 45 46; do printf '%s\t%s\n' "$B" "$(ago "$n")" > "$(bobj "$n")"; done # all just uploaded (fresh)
printf '%s\t%s\n' "$C" "$(ago 50)" > "$dir/erasures-$(day 1).log.partial.42"; age_object "$dir/erasures-$(day 1).log.partial.42" 46
printf '%s\t%s\n' "$C" "$(ago 3)" > "$(bobj 3)"; age_object "$(bobj 3)" 46 # an object last written 46 days ago
up || fail "upload exited non-zero"
[ -e "$(bobj 44)" ] || fail "the object 44 days back was deleted"
[ -e "$(bobj 45)" ] || fail "the object 45 days back was deleted"
[ ! -e "$(bobj 46)" ] || fail "the object 46 days back was kept"
[ "$(cat "$(bobj 45)")" = "$B$tab$(ago 45)" ] || fail "the object 45 days back was changed"
[ ! -e "$dir/erasures-$(day 1).log.partial.42" ] || fail "a stale .partial was kept"
[ ! -e "$(bobj 3)" ] || fail "an object last written more than 45 days ago was kept"
grep -q " deletefile bk:plateandbar-backups/erasure-ledger/staging/erasures-$(day 46).log$" "$STUB_LOG" || fail "the day object past retention was not deleted by name"

echo "upload: day objects past retention are pruned under every prefix, not only the VM's own (#911)"
reset; mkdir -p "$dir"
other="$tmp/bucket/erasure-ledger/production"; mkdir -p "$other" "$tmp/bucket/erasure-ledger/retired"
for n in 44 45 46 47; do printf '%s\t%s\n' "$B" "$(ago "$n")" > "$other/erasures-$(day "$n").log"; done
printf '%s\t%s\n' "$C" "$(ago 60)" > "$tmp/bucket/erasure-ledger/retired/erasures-$(day 60).log"
printf '%s\t%s\n' "$C" "$(ago 3)" > "$tmp/bucket/erasure-ledger/retired/erasures-$(day 3).log"
printf '%s\t%s\n' "$C" "$(ago 3)" > "$tmp/bucket/erasure-ledger/retired/unrelated.txt"
up || fail "upload exited non-zero"
[ -e "$other/erasures-$(day 44).log" ] && [ -e "$other/erasures-$(day 45).log" ] || fail "another prefix's object within retention was deleted"
[ ! -e "$other/erasures-$(day 46).log" ] || fail "another prefix's object 46 days back was kept"
[ ! -e "$other/erasures-$(day 47).log" ] || fail "another prefix's object 47 days back was kept"
[ ! -e "$tmp/bucket/erasure-ledger/retired/erasures-$(day 60).log" ] || fail "a retired prefix's old object was kept"
[ -e "$tmp/bucket/erasure-ledger/retired/erasures-$(day 3).log" ] || fail "a retired prefix's recent object was deleted"
[ -e "$tmp/bucket/erasure-ledger/retired/unrelated.txt" ] || fail "a file that is no day object was deleted"
grep -q " deletefile bk:plateandbar-backups/erasure-ledger/production/erasures-$(day 46).log$" "$STUB_LOG" || fail "not deleted by name under its own prefix"
if STUB_LSF_R_FAIL=1 up; then fail "a failed listing of the whole ledger root: exited 0"; fi
grep -q 'cannot list bk:plateandbar-backups/erasure-ledger' "$tmp/out" || fail "a failed root listing was not reported"

echo "upload: the old 45-day snapshot objects are split into day objects, then deleted"
reset; mkdir -p "$dir"
{
  printf '%s\t%s\n' "$A" "$(ago 3)" "$B" "$(ago 2)" "$C" "$(ago 2)" "$D" "$(ago 50)"
  printf 'junk\n'
} > "$dir/ledger-20261001.log"
printf '%s\t%s\n' "$A" "$(ago 2)" > "$dir/ledger-20261002.log"
up || fail "upload with snapshots exited non-zero"
[ ! -e "$dir/ledger-20261001.log" ] || fail "a snapshot object was kept"
[ ! -e "$dir/ledger-20261002.log" ] || fail "a snapshot object was kept"
[ "$(cat "$(bobj 3)")" = "$A$tab$(ago 3)" ] || fail "day 3 object: $(cat "$(bobj 3)")"
[ "$(count "$(bobj 2)")" = 3 ] || fail "day 2 object: $(cat "$(bobj 2)")"
[ -e "$(bobj 0)" ] || fail "no object for today"
[ "$(objects)" = 3 ] || fail "expected 3 day objects, got: $(ls "$dir")"
for o in "$dir"/*; do only_its_day "$o" || fail "$o holds another day's entry"; done
! grep -rq "^$D" "$dir" || fail "an entry past retention was copied from a snapshot"
grep -q 'skipped 1 malformed' "$tmp/out" || fail "the malformed snapshot line was not reported"
grep -q 'split 2 snapshot object(s)' "$tmp/out" || fail "the split was not reported"

echo "upload: the single erasures.log is split into day files on the volume, once"
reset
{
  printf '%s\t%s\n' "$A" "$(ago 3)" "$B" "$(ago 0)" "$C" "$(ago 3)" "$D" "$(ago 50)"
  printf '%s\n' "${B:0:20}"
  printf '%s\t%s' "$C" "$(ago 1 | cut -c1-12)" # cut, no final newline
} > "$vol/erasures.log"
printf '%s\t%s\n' "$D" "$(ago 0)" > "$(vfile 0)" # the new API already writes today's file
up || fail "upload with erasures.log exited non-zero"
[ ! -e "$vol/erasures.log" ] || fail "the old file was kept"
[ ! -e "$vol/erasures.log.migrating" ] || fail "the renamed old file was kept"
[ "$(cat "$(vfile 3)")" = "$A$tab$(ago 3)"$'\n'"$C$tab$(ago 3)" ] || fail "day 3 file: $(cat "$(vfile 3)")"
[ "$(cat "$(vfile 0)")" = "$D$tab$(ago 0)"$'\n'"$B$tab$(ago 0)" ] || fail "today's file was not appended to: $(cat "$(vfile 0)")"
[ "$(find "$vol" -type f | wc -l | tr -d ' ')" = 2 ] || fail "unexpected files on the volume: $(ls "$vol")"
case "$(ls -l "$(vfile 3)")" in -rw-------*) ;; *) fail "a day file made by the split is not owner-only" ;; esac
grep -q 'split into day files: 3 entries kept, 3 past retention or malformed dropped' "$tmp/out" || fail "the split was not reported"
grep -Eq -- "--user 10001:10001 -v plateandbar-staging_erasure_ledger:/ledger --entrypoint sh .*mv erasures.log erasures.log.migrating" "$STUB_LOG" || fail "the old file was not renamed first as the API's user"
grep -q 'sync && rm erasures.log.migrating' "$here/ledger-upload.sh" || fail "the day files are not synced before the old file goes"
[ "$(count "$(bobj 3)")" = 2 ] || fail "the split entries of day 3 were not uploaded"
[ "$(count "$(bobj 0)")" = 2 ] || fail "the split entry of today was not uploaded"
: > "$STUB_LOG"
up || fail "second upload exited non-zero"
! grep -q 'split into day files' "$tmp/out" || fail "the split ran twice"
[ "$(count "$(vfile 3)")" = 2 ] || fail "the second run changed a day file"
# a split that stopped half way (renamed, not removed) resumes; an erasures.log written meanwhile waits for the next run
reset
printf '%s\t%s\n' "$A" "$(ago 1)" > "$vol/erasures.log.migrating"
printf '%s\t%s\n' "$B" "$(ago 1)" > "$vol/erasures.log"
up || fail "resumed split exited non-zero"
[ ! -e "$vol/erasures.log.migrating" ] || fail "the resumed split did not finish"
[ -e "$vol/erasures.log" ] || fail "the resumed split took the new erasures.log too"
[ "$(cat "$(vfile 1)")" = "$A$tab$(ago 1)" ] || fail "the resumed split lost its entry"
up || fail "next run exited non-zero"
[ ! -e "$vol/erasures.log" ] || fail "erasures.log was not split on the next run"
[ "$(count "$(vfile 1)")" = 2 ] || fail "the next run lost an entry from the day file"
[ "$(count "$(bobj 1)")" = 2 ] || fail "the next run lost an entry from the day object"
# the usual crash: renamed, then stopped, with no newer erasures.log
reset
printf '%s\t%s\n%s\t%s\n' "$A" "$(ago 2)" "$B" "$(ago 50)" > "$vol/erasures.log.migrating"
up || fail "a lone erasures.log.migrating: exited non-zero"
[ ! -e "$vol/erasures.log.migrating" ] || fail "a lone erasures.log.migrating was left behind"
[ "$(cat "$(vfile 2)")" = "$A$tab$(ago 2)" ] || fail "a lone erasures.log.migrating was not split"
[ "$(cat "$(bobj 2)")" = "$A$tab$(ago 2)" ] || fail "a lone erasures.log.migrating was not uploaded"
[ "$(find "$vol" -type f | wc -l | tr -d ' ')" = 1 ] || fail "an entry past retention was kept: $(ls "$vol")"
# a day file that ends in a cut line (a write torn by a power loss): the split's entry starts on a new line
reset
printf '%s\t%s' "$C" "$(ago 1 | cut -c1-12)" > "$(vfile 1)"
printf '%s\t%s\n' "$A" "$(ago 1)" > "$vol/erasures.log"
up || fail "split onto a cut line exited non-zero"
[ "$(cat "$(vfile 1)")" = "$C$tab$(ago 1 | cut -c1-12)"$'\n'"$A$tab$(ago 1)" ] || fail "the split glued an entry onto a cut line: $(cat "$(vfile 1)")"
[ "$(cat "$(bobj 1)")" = "$A$tab$(ago 1)" ] || fail "the entry after a cut line was not uploaded"

echo "upload: a malformed local line is skipped and reported; no ledger yet uploads an empty object"
reset
printf '%s\t%s\n%s\n%s\t%s\n%s' "$A" "$(ago 1)" "${B:0:20}" "$C" "$(ago 1).5" "${D}${tab}2026-10" > "$(vfile 1)"
up || fail "upload with malformed lines exited non-zero"
[ "$(count "$(bobj 1)")" = 1 ] || fail "expected only the valid line, got $(count "$(bobj 1)")"
grep -q 'skipped 3 malformed' "$tmp/out" || fail "malformed lines not reported"
reset
up || fail "upload with no ledger file exited non-zero"
[ -e "$(bobj 0)" ] || fail "no object for an empty ledger"
[ ! -s "$(bobj 0)" ] || fail "the object for an empty ledger is not empty"

echo "upload: failures upload nothing"
reset; printf '%s\t%s\n' "$A" "$(ago 1)" > "$(vfile 1)"
if STUB_NO_VOLUME=1 up; then fail "missing volume: exited 0"; fi
grep -q 'volume plateandbar-staging_erasure_ledger does not exist' "$tmp/out" || fail "missing volume not explained"
[ ! -e "$dir" ] || fail "uploaded without a volume"
if STUB_VOLUME_FAIL=1 up; then fail "unreadable ledger: exited 0"; fi
if STUB_LSF_FAIL=1 up; then fail "failed listing: exited 0"; fi
mkdir -p "$dir"; printf '%s\t%s\n' "$B" "$(ago 2)" > "$(bobj 2)"
if STUB_CAT_FAIL=1 up; then fail "failed download: exited 0"; fi
! grep -Eq ' (rcat|moveto|delete|deletefile) ' "$STUB_LOG" || fail "a failed run wrote to the bucket"

echo "upload: heartbeat goes to curl on stdin, only after success"
reset; printf '%s\t%s\n' "$A" "$(ago 1)" > "$(vfile 1)"
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

echo "replay: a ledgered user leaves no rows, across several day objects and an old snapshot, fractional seconds and batches"
reset; mkdir -p "$dir"
printf '%s\t%s\n' "$A" "$(ago 5)" > "$(bobj 5)"
printf '%s\t%s.123456Z\n' "$C" "$(ago 2 | sed 's/Z$//')" > "$(bobj 2)"
printf '%s\t%s\n%s\t%s' "$C" "$(ago 1)" "$A" "$(ago 1)" > "$(bobj 1)" # duplicates, no final newline
printf '%s\t%s\n' "$A" "$(ago 6)" > "$dir/ledger-20261001.log" # a snapshot of the first version, not split yet
replay live || fail "replay exited non-zero"
[ "$(tr '\n' ' ' < "$tmp/db/users.txt")" = "$B $D " ] || fail "users left: $(cat "$tmp/db/users.txt")"
[ "$(tr '\n' ' ' < "$tmp/db/weights.txt")" = "$B " ] || fail "child rows left: $(cat "$tmp/db/weights.txt")"
# the e-mail tables have no foreign key: the ledgered users' e-mails go, the others' stay
[ "$(tr '\n' ' ' < "$tmp/db/codes.txt")" = "b@x.test d@x.test " ] || fail "email_sign_in_codes left: $(cat "$tmp/db/codes.txt")"
[ "$(tr '\n' ' ' < "$tmp/db/failures.txt")" = "b@x.test " ] || fail "email_verify_failures left: $(cat "$tmp/db/failures.txt")"
for t in 'email_sign_in_codes c JOIN users u ON c.email = u.email' \
  "email_sign_in_codes c JOIN auth_identities a ON a.provider = 'email' AND c.email = a.provider_subject" \
  'email_verify_failures f JOIN users u ON f.email = u.email' \
  "email_verify_failures f JOIN auth_identities a ON a.provider = 'email' AND f.email = a.provider_subject"; do
  grep -qF "FROM $t WHERE" "$STUB_SQL" || fail "missing delete: $t"
done
# the e-mail rows go before the users row, and ROW_COUNT() follows the users delete directly
[ "$(grep -n 'email_verify_failures f JOIN auth' "$STUB_SQL" | head -1 | cut -d: -f1)" -lt "$(grep -n '^DELETE FROM users' "$STUB_SQL" | head -1 | cut -d: -f1)" ] || fail "e-mail rows are not deleted before users"
grep -A1 '^DELETE FROM users' "$STUB_SQL" | grep -q '^SELECT ROW_COUNT();$' || fail "ROW_COUNT() does not follow the users delete"
grep -q '^target: compose project' "$tmp/out" || fail "live mode did not print its target"
grep -q 'removed 2 user' "$tmp/out" || fail "wrong removed count"
grep -q '4 object(s), 5 line(s), 2 distinct user id(s), 0 malformed' "$tmp/out" || fail "wrong ledger summary"
grep -q '^compose exec -T mysql ' "$STUB_LOG" || fail "live mode did not use the stack's mysql"
! grep -q 'change-me' "$STUB_LOG" || fail "a secret appears on a docker command line"
! grep -Eq "$A|$C" "$tmp/out" || fail "a user id was printed"

reset; mkdir -p "$dir"; : > "$tmp/many"
for i in $(seq 1 1200); do printf '%08x-0000-4000-8000-000000000000\t%s\n' "$((i + 4096 * 65536))" "$(ago 1)" >> "$tmp/many"; done
cp "$tmp/many" "$(bobj 1)"
cut -f1 "$tmp/many" > "$tmp/db/users.txt"; printf '%s\n' "$B" >> "$tmp/db/users.txt"
replay container plateandbar-restore-check-1 || fail "batched replay exited non-zero"
[ "$(cat "$tmp/db/users.txt")" = "$B" ] || fail "batched replay left $(count "$tmp/db/users.txt") users"
[ "$(grep -c '^DELETE FROM users' "$STUB_SQL")" = 3 ] || fail "expected 3 batches of at most 500"
grep -q '^exec -i plateandbar-restore-check-1 ' "$STUB_LOG" || fail "container mode did not use docker exec"
grep -q '^target: container plateandbar-restore-check-1' "$tmp/out" || fail "container mode did not print its target"
! grep -q '^compose' "$STUB_LOG" || fail "container mode used docker compose"

echo "replay: live mode refuses while the API container is running and deletes nothing"
reset; mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$(bobj 1)"
if STUB_API_RUNNING=1 replay live; then fail "API running: exited 0"; fi
grep -q 'the API container is running' "$tmp/out" || fail "API running not explained"
[ ! -s "$STUB_SQL" ] || fail "SQL ran while the API was running"
grep -q '^compose ps -q --status running api$' "$STUB_LOG" || fail "the API state was not checked"

echo "replay: the compose ledger directory is the volume the uploader reads"
grep -q 'ERASURE_LEDGER_DIR: /var/lib/plateandbar/erasure$' "$here/docker-compose.yml" || fail "ERASURE_LEDGER_DIR changed: ledger-upload.sh reads the top of the volume"
grep -q '^      - erasure_ledger:/var/lib/plateandbar/erasure$' "$here/docker-compose.yml" || fail "the volume is not mounted at the ledger directory"

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
} > "$(bobj 1)"
replay live || fail "replay with malformed lines exited non-zero"
grep -q '7 malformed line(s) skipped' "$tmp/out" || fail "malformed count not reported"
grep -q 'warning: 7 malformed' "$tmp/out" || fail "no warning"
[ "$(tr '\n' ' ' < "$tmp/db/users.txt")" = "$B $C $D " ] || fail "malformed lines were acted on: $(cat "$tmp/db/users.txt")"
! grep -q "${B:0:18}" "$tmp/out" || fail "a malformed line was printed"

echo "replay: an empty ledger is fine; a missing or unreadable one fails and deletes nothing"
reset; mkdir -p "$dir"; : > "$(bobj 1)"
replay live || fail "an empty ledger failed"
grep -q 'nothing to delete' "$tmp/out" || fail "empty ledger not reported"
[ "$(count "$tmp/db/users.txt")" = 4 ] || fail "an empty ledger deleted users"
reset
if replay live; then fail "no ledger object: exited 0"; fi
grep -q 'no ledger object' "$tmp/out" || fail "missing ledger not explained"
reset; mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$(bobj 1)"
if STUB_LSF_FAIL=1 replay live; then fail "failed listing: exited 0"; fi
if STUB_CAT_FAIL=1 replay live; then fail "failed download: exited 0"; fi
if STUB_LSF_FAIL=3 replay live; then fail "rclone exit 3 (missing bucket): exited 0"; fi
grep -q 'cannot list' "$tmp/out" || fail "exit 3 was not reported as a failed listing"
[ ! -s "$STUB_SQL" ] || fail "SQL ran although the ledger could not be read"
[ "$(count "$tmp/db/users.txt")" = 4 ] || fail "users deleted without a ledger"
mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$(bobj 1)"; : > "$(bobj 1).partial.7"
reset; mkdir -p "$dir"; : > "$(bobj 1).partial.7"
if replay live; then fail "only a .partial object: exited 0"; fi

echo "replay: a failed delete fails and prints only the error number"
reset; mkdir -p "$dir"; printf '%s\t%s\n' "$A" "$(ago 1)" > "$(bobj 1)"
if STUB_DELETE_FAIL=1 replay live; then fail "failed delete: exited 0"; fi
grep -q 'mysql ERROR 1451' "$tmp/out" || fail "no error number"
! grep -q 'secret-row-content' "$tmp/out" || fail "row content printed"
if replay; then fail "no mode: exited 0"; fi
if replay container; then fail "container without a name: exited 0"; fi

echo "ledger tests passed"
