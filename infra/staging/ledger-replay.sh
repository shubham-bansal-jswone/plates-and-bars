#!/usr/bin/env bash
# Replays the erasure ledger (#850, #853) into a database that was just loaded from a dump, so accounts deleted after
# that dump was taken are deleted again before the API serves. Run it after EVERY dump load:
#   ./ledger-replay.sh live              the stack's MySQL (RUNBOOK.md section 4, API stopped)
#   ./ledger-replay.sh container NAME    a throwaway container (restore-check.sh)
# It fetches every object under bk:<bucket>/erasure-ledger/<prefix>/ (see ledger-upload.sh), merges them, and runs
# DELETE FROM users WHERE id IN (...) for every distinct user id. Every per-user table cascades from users.
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
    sql() { docker compose exec -T mysql sh -c "$inner"; } ;;
  container) [ "$#" -eq 2 ] && [ -n "$2" ] || fail "usage: ledger-replay.sh live | container NAME"
    name="$2"
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

# ids match the strict pattern above, so they are safe to put in SQL. 500 per statement.
split -l 500 "$work/ids" "$work/batch."
for b in "$work"/batch.*; do
  printf "DELETE FROM users WHERE id IN (%s);\nSELECT ROW_COUNT();\n" "$(sed "s/.*/'&'/" "$b" | paste -sd, -)"
done > "$work/delete.sql"
# mysql error text can quote row values: print only the error numbers
sql < "$work/delete.sql" > "$work/counts" 2> "$work/err" || {
  sed -n 's/^ERROR \([0-9]*\).*/mysql ERROR \1/p' "$work/err" >&2
  fail "the delete failed"
}
removed="$(awk '{s += $1} END {print s + 0}' "$work/counts")"
echo "ledger replay ok: removed $removed user(s) the dump still contained"
