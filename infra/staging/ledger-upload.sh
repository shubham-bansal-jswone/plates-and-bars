#!/usr/bin/env bash
# Hourly upload of the erasure ledger (#850, #853) to the backup bucket, from cron on the VM, see RUNBOOK.md section 3a:
#   5 * * * * cd /opt/plateandbar/infra/staging && ./ledger-upload.sh >> "$HOME/plateandbar-ledger-upload.log" 2>&1
# The API appends "<user id> TAB <UTC time>" to a file on the erasure_ledger volume on every account deletion. A
# restore replays the ledger (ledger-replay.sh) so deleted accounts stay deleted. This script copies it off the VM
# into bk:<bucket>/erasure-ledger/<prefix>/ledger-<UTC date>.log. It never overwrites a longer copy: the day's object
# is merged with the local ledger (union of valid lines) and the union is uploaded, so it is never shorter than what
# the bucket already holds. Entries and objects older than 45 days are dropped from the uploaded copy only: the live
# file is never rewritten (the API appends to it). A line that does not match the format is skipped and counted (a cut
# line comes only from a request that answered 500 and deleted nothing). No ledger file yet (no deletion so far) uploads an
# empty object, so replay can tell "no erasures" from "no ledger". The ledger holds opaque ids and times only.
# Optional LEDGER_HEARTBEAT_URL (Uptime Kuma push, heartbeat interval about 2 hours): requested after a fully successful
# run. A failed run sends nothing. Unset = off. Needs .env (see .env.example) and Docker.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ledger-lib.sh
. ./ledger-lib.sh

ledger_volume="plateandbar-staging_erasure_ledger" # compose project name + volume, see docker-compose.yml
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail() { echo "ledger-upload FAILED: $*" >&2; exit 1; }

# docker run would silently create a missing volume and read it as an empty ledger: refuse that
docker volume inspect "$ledger_volume" > /dev/null 2>&1 || fail "volume $ledger_volume does not exist (is the stack's project name still plateandbar-staging?)"
docker run --rm -v "$ledger_volume:/ledger:ro" --entrypoint sh "$rclone_image" \
  -c 'if [ -e /ledger/erasures.log ]; then cat /ledger/erasures.log; fi' > "$work/local.raw" \
  || fail "cannot read the ledger from the volume"

now="$(date -u +%s)"
cutoff_epoch=$((now - ledger_retention_days * 86400))
cutoff="$(date -u -d "@$cutoff_epoch" +%Y-%m-%dT%H:%M:%S 2> /dev/null || date -u -r "$cutoff_epoch" +%Y-%m-%dT%H:%M:%S)"
# valid lines only, newer than the cutoff (the first 19 characters of the time compare as text)
valid() { { grep -E -x "$ledger_line" || true; } | awk -F'\t' -v c="$cutoff" 'substr($2, 1, 19) >= c'; }

nonblank="$(grep -c -v '^$' "$work/local.raw" || true)"
{ grep -E -x -c "$ledger_line" "$work/local.raw" || true; } > "$work/valid.count"
skipped=$((nonblank - $(cat "$work/valid.count")))
if [ "$skipped" -gt 0 ]; then echo "warning: skipped $skipped malformed ledger line(s) (not uploaded)" >&2; fi

obj="ledger-$(date -u +%Y%m%d).log"
listing="$(list_ledger_objects)" || fail "cannot list $ledger_dest (check the BACKUP_S3_* values and the bucket)"
: > "$work/existing.raw"
if printf '%s\n' "$listing" | grep -qx "$obj"; then
  rclone cat "$ledger_dest/$obj" > "$work/existing.raw" || fail "cannot read the bucket copy $obj"
fi
printf '\n' >> "$work/existing.raw" # an object cut mid-line must not glue onto the next file

# the union: never shorter than the bucket copy (apart from entries past retention)
{ valid < "$work/existing.raw"; valid < "$work/local.raw"; } | sort -u > "$work/merged"
{ grep -v '^$' "$work/existing.raw" || true; } | sort -u > "$work/existing.sorted"
if printf '%s\n' "$listing" | grep -qx "$obj" && cmp -s "$work/merged" "$work/existing.sorted"; then
  echo "ledger unchanged: $obj ($(wc -l < "$work/merged" | tr -d ' ') entries)"
else
  # .partial first, renamed only after the whole upload succeeded (as backup.sh does)
  # (a per-run suffix: a manual run overlapping the cron run must not share the name)
  rclone rcat "$ledger_dest/$obj.partial.$$" < "$work/merged"
  rclone moveto "$ledger_dest/$obj.partial.$$" "$ledger_dest/$obj"
  echo "ledger uploaded: $obj ($(wc -l < "$work/merged" | tr -d ' ') entries)"
fi

# objects (and stale .partial files) older than the retention
rclone delete --min-age "${ledger_retention_days}d" "$ledger_dest"

if [ -n "${LEDGER_HEARTBEAT_URL:-}" ]; then
  printf 'url = "%s"\n' "$LEDGER_HEARTBEAT_URL" | curl -fsS -m 10 --retry 3 -o /dev/null -K - \
    || echo "warning: heartbeat ping failed (the upload itself succeeded)" >&2
fi
