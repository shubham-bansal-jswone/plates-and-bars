#!/usr/bin/env bash
# Replays the erasure ledger (#850, #853) into a database that was just loaded from a dump, so accounts deleted after
# that dump was taken are deleted again before the API serves. Run it after EVERY dump load:
#   ./ledger-replay.sh live              the stack's MySQL (RUNBOOK.md section 4); refuses while the API container runs
#   ./ledger-replay.sh container NAME    a throwaway container (restore-check.sh)
# It fetches every object under bk:<bucket>/erasure-ledger/<prefix>/ (see ledger-upload.sh), merges them, and runs
# the same per-user deletion as DELETE /me for every distinct user id: the rows of email_sign_in_codes and
# email_verify_failures keyed by the user's e-mail (they have no foreign key to users, so they do not cascade; found
# through users and auth_identities, so they go first), then DELETE FROM users, from which the other per-user tables
# cascade.
# A line that is not "<ErasureLedger.ID> TAB <ISO UTC time>" is skipped, counted and reported (a cut line comes only from
# a request that answered 500 and deleted nothing). The run fails only when the ledger is missing (no object in the
# bucket, or the bucket cannot be read) or the delete itself fails. Prints counts, never ids or row contents.
# Run ./ledger-upload.sh first when the VM is alive: it adds the last hour's deletions to the bucket.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ledger-lib.sh
. ./ledger-lib.sh

fail() { echo "ledger-replay FAILED: $*" >&2; exit 1; }
# shellcheck disable=SC2016 # the password variable is expanded inside the container, not here
inner='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B plateandbar'
case "${1:-}" in
  live) [ "$#" -eq 1 ] || fail "usage: ledger-replay.sh live | container NAME"
    # the API must not serve (or write) between the dump load and the replay
    [ -z "$(docker compose ps -q --status running api)" ] || fail "the API container is running: docker compose stop api first"
    echo "target: compose project in $PWD, service mysql, database plateandbar"
    sql() { docker compose exec -T mysql sh -c "$inner"; } ;;
  container) [ "$#" -eq 2 ] || fail "usage: ledger-replay.sh live | container NAME"
    [ -n "$2" ] || fail "usage: ledger-replay.sh live | container NAME"
    name="$2"
    echo "target: container $name, database plateandbar"
    sql() { docker exec -i "$name" sh -c "$inner"; } ;;
  *) fail "usage: ledger-replay.sh live | container NAME" ;;
esac

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

objects="$(list_ledger_objects)" || fail "cannot list $ledger_dest (check the BACKUP_S3_* values and the bucket); the ledger could not be read, so the restore must not be served"
[ -n "$objects" ] || fail "no ledger object under $ledger_dest: deleted accounts cannot be replayed (is ledger-upload.sh scheduled?)"
: > "$work/all"
n_objects=0
while IFS= read -r o; do
  rclone cat "$ledger_dest/$o" < /dev/null >> "$work/all" || fail "the download of $o failed"
  printf '\n' >> "$work/all" # an object cut mid-line must not glue onto the next object
  n_objects=$((n_objects + 1))
done <<< "$objects"

lines="$(grep -c -v '^$' "$work/all" || true)"
{ grep -E -x "$ledger_line" "$work/all" || true; } | cut -f1 | sort -u > "$work/ids"
valid="$(grep -E -x -c "$ledger_line" "$work/all" || true)"
skipped=$((lines - valid))
n_ids="$(wc -l < "$work/ids" | tr -d ' ')"
echo "ledger: $n_objects object(s), $lines line(s), $n_ids distinct user id(s), $skipped malformed line(s) skipped"
if [ "$skipped" -gt 0 ]; then echo "warning: $skipped malformed ledger line(s) skipped (a cut line deleted nothing; check the API log if unexpected)" >&2; fi

if [ "$n_ids" -eq 0 ]; then echo "ledger replay ok: nothing to delete"; exit 0; fi

# ids match the strict pattern above, so they are safe to put in SQL; check once more right before building it.
if grep -Evxq '[0-9a-f-]{36}' "$work/ids"; then fail "an id is not a 36-character lower-case id; nothing was deleted"; fi
# 500 per batch. The e-mail rows go first: they are found through users and auth_identities, which the users delete
# removes. ROW_COUNT() stays right after the users delete, so the count is the number of users.
split -l 500 "$work/ids" "$work/batch."
for b in "$work"/batch.*; do
  in="$(sed "s/.*/'&'/" "$b" | paste -sd, -)"
  printf '%s\n' \
    "DELETE c FROM email_sign_in_codes c JOIN users u ON c.email = u.email WHERE u.id IN ($in);" \
    "DELETE c FROM email_sign_in_codes c JOIN auth_identities a ON a.provider = 'email' AND c.email = a.provider_subject WHERE a.user_id IN ($in);" \
    "DELETE f FROM email_verify_failures f JOIN users u ON f.email = u.email WHERE u.id IN ($in);" \
    "DELETE f FROM email_verify_failures f JOIN auth_identities a ON a.provider = 'email' AND f.email = a.provider_subject WHERE a.user_id IN ($in);" \
    "DELETE FROM users WHERE id IN ($in);" \
    "SELECT ROW_COUNT();"
done > "$work/delete.sql"
# mysql error text can quote row values: print only the error numbers
sql < "$work/delete.sql" > "$work/counts" 2> "$work/err" || {
  sed -n 's/^ERROR \([0-9]*\).*/mysql ERROR \1/p' "$work/err" >&2
  fail "the delete failed"
}
removed="$(awk '{s += $1} END {print s + 0}' "$work/counts")"
echo "ledger replay ok: removed $removed user(s) the dump still contained"
