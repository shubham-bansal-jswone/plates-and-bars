#!/usr/bin/env bash
# Hourly upload of the erasure ledger (#850, #853, #887) to the backup bucket, from cron on the VM, see RUNBOOK.md section 3a:
#   5 * * * * cd /opt/plateandbar/infra/staging && ./ledger-upload.sh >> "$HOME/plateandbar-ledger-upload.log" 2>&1
# The API appends "<user id> TAB <UTC time>" to erasures-<UTC day>.log on the erasure_ledger volume on every account
# deletion (one file per UTC day, #887). A restore replays the ledger (ledger-replay.sh) so deleted accounts stay
# deleted. Every copy keeps 45 days, by whole UTC days: a day is kept while it is at most 45 days before today (UTC),
# so an entry lives at least 45 days and at most 46 days plus one cron interval. Each run, in this order:
# 1. Splits a single erasures.log left by the first ledger version (#854) into day files, once. It is renamed to
#    erasures.log.migrating first, so an entry an old API image appends meanwhile lands in a new erasures.log for the
#    next run; the day files are synced before the old file is removed. Entries past retention are dropped.
# 2. Deletes the local day files past retention (before the bucket is touched, so a bucket outage cannot keep them).
# 3. Uploads each day to its own object bk:<bucket>/erasure-ledger/<prefix>/erasures-<day>.log holding only that
#    day's entries. It never overwrites a longer copy: the day's object is merged with the local lines (union of valid
#    lines) and the union is uploaded. Today's object is always written, empty when there is no entry, so replay can
#    tell "no erasures" from "no ledger". The oldest kept day is no longer uploaded: its object may already have aged
#    out below and must not come back for another 45 days.
# 4. Splits the 45-day snapshot objects ledger-YYYYMMDD.log written before #887 into the day objects, then deletes them.
# 5. Deletes the day objects past retention, and every object older than 45 days (rclone --min-age, which also
#    removes stale .partial uploads).
# A line that does not match the format is skipped and counted (a cut line comes only from a request that answered 500
# and deleted nothing). The ledger holds opaque ids and times only.
# Optional LEDGER_HEARTBEAT_URL (Uptime Kuma push, heartbeat interval about 2 hours): requested after a fully successful
# run. A failed run sends nothing. Unset = off. Needs .env (see .env.example) and Docker.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ledger-lib.sh
. ./ledger-lib.sh

ledger_volume="plateandbar-staging_erasure_ledger" # compose project name + volume, see docker-compose.yml
# The API's user (backend/Dockerfile, useradd --uid 10001). Everything that writes to the volume runs as it, so a day
# file created here stays appendable by the API.
app_user="10001:10001"
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail() { echo "ledger-upload FAILED: $*" >&2; exit 1; }

# Runs a POSIX sh script (the pinned rclone image is busybox) with the volume at /ledger; $1 is ":ro" or "".
on_volume() {
  local mode="$1"
  shift
  docker run --rm -i --user "$app_user" -v "$ledger_volume:/ledger$mode" --entrypoint sh "$rclone_image" -c "$@"
}
# Copies every ledger file on the volume to $work/vol.
read_volume() {
  rm -rf "$work/vol" "$work/vol.tar"
  mkdir "$work/vol"
  # shellcheck disable=SC2016 # expanded by the shell in the container
  on_volume :ro 'cd /ledger && set -- erasures*.log* && if [ -e "$1" ]; then tar -cf - "$@"; fi' < /dev/null > "$work/vol.tar" \
    || fail "cannot read the ledger from the volume"
  if [ -s "$work/vol.tar" ]; then tar -xf "$work/vol.tar" -C "$work/vol" || fail "cannot read the ledger from the volume"; fi
}
valid_lines() { grep -E -x "$ledger_line" "$@" || true; }
day_of() { [[ "$1" =~ ^erasures-([0-9]{4}-[0-9]{2}-[0-9]{2})\.log$ ]] && printf '%s' "${BASH_REMATCH[1]}"; }

# docker run would silently create a missing volume and read it as an empty ledger: refuse that
docker volume inspect "$ledger_volume" > /dev/null 2>&1 || fail "volume $ledger_volume does not exist (is the stack's project name still plateandbar-staging?)"

today="$(date -u +%Y-%m-%d)"
keep_from="$(utc_day_ago "$ledger_retention_days")"              # oldest day kept, on the VM and in the bucket
upload_from="$(utc_day_ago $((ledger_retention_days - 1)))"      # oldest day still uploaded
read_volume

# 1. the single erasures.log of the first ledger version, split into day files once
if [ -e "$work/vol/erasures.log" ] || [ -e "$work/vol/erasures.log.migrating" ]; then
  on_volume '' 'cd /ledger && if [ ! -e erasures.log.migrating ]; then mv erasures.log erasures.log.migrating; fi' < /dev/null \
    || fail "cannot rename erasures.log for the split"
  on_volume :ro 'cat /ledger/erasures.log.migrating' < /dev/null > "$work/old" || fail "cannot read erasures.log.migrating"
  printf '\n' >> "$work/old"
  valid_lines "$work/old" | awk -F'\t' -v k="$keep_from" '{ d = substr($2, 1, 10) } d >= k { print d " " $0 }' > "$work/split"
  # appended (the API may be writing today's file), synced, and only then the old file goes. A file that ends in a cut
  # line (a write torn by a power loss, also a split that stopped half way) first gets a newline, so no entry is glued
  # onto it. umask 077: busybox starts with 022, and the day files must stay owner-only.
  # shellcheck disable=SC2016
  on_volume '' 'umask 077 && cd /ledger && while IFS=" " read -r d line; do f="erasures-$d.log"; if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf "\n" >> "$f"; fi; printf "%s\n" "$line" >> "$f"; done && sync && rm erasures.log.migrating && sync' < "$work/split" \
    || fail "cannot split erasures.log into day files"
  echo "erasures.log split into day files: $(wc -l < "$work/split" | tr -d ' ') entries kept, $(($(grep -c -v '^$' "$work/old" || true) - $(wc -l < "$work/split"))) past retention or malformed dropped"
  read_volume
fi

# 2. local day files past retention
old_files=()
for f in "$work"/vol/erasures-*.log; do
  d="$(day_of "${f##*/}")" || continue
  if [[ "$d" < "$keep_from" ]]; then old_files+=("${f##*/}"); rm "$f"; fi
done
if [ "${#old_files[@]}" -gt 0 ]; then
  # shellcheck disable=SC2016
  on_volume '' 'cd /ledger && rm -f "$@" && sync' sh "${old_files[@]}" < /dev/null || fail "cannot delete the day files past retention"
  echo "deleted ${#old_files[@]} local day file(s) more than $ledger_retention_days days old"
fi

# 3. one object per day
listing="$(list_ledger_objects)" || fail "cannot list $ledger_dest (check the BACKUP_S3_* values and the bucket)"
mkdir "$work/bucket" "$work/days"
if [ -n "$listing" ]; then
  # every ledger object in one container, not one per object
  docker run --rm -e RCLONE_CONFIG_BK_TYPE -e RCLONE_CONFIG_BK_PROVIDER -e RCLONE_CONFIG_BK_NO_CHECK_BUCKET \
    -e RCLONE_CONFIG_BK_ENDPOINT -e RCLONE_CONFIG_BK_ACCESS_KEY_ID -e RCLONE_CONFIG_BK_SECRET_ACCESS_KEY \
    -v "$work/bucket:/out" "$rclone_image" copy "$ledger_dest" /out --include 'erasures-*.log' --include 'ledger-*.log' < /dev/null \
    || fail "cannot download the bucket copies"
fi
in_bucket() { printf '%s\n' "$listing" | grep -Fqx "$1"; }
# every valid line, local or in the bucket, goes to the file of its own UTC day: an object never holds another day's
# entry, the snapshots are split, and an object is never replaced by a shorter one (apart from malformed lines)
: > "$work/all"
for f in "$work"/vol/erasures-*.log; do
  [ -e "$f" ] || continue
  cat "$f" >> "$work/all"
  printf '\n' >> "$work/all" # a file cut mid-line must not glue onto the next file
done
old_objects=()
while IFS= read -r o; do
  [ -n "$o" ] || continue
  [ -e "$work/bucket/$o" ] || fail "the download of $o is missing"
  cat "$work/bucket/$o" >> "$work/all"
  printf '\n' >> "$work/all"
  if [[ "$o" =~ $ledger_old_object ]]; then old_objects+=("$o"); fi
done <<< "$listing"
skipped=$(($(grep -c -v '^$' "$work/all" || true) - $(grep -E -x -c "$ledger_line" "$work/all" || true)))
if [ "$skipped" -gt 0 ]; then echo "warning: skipped $skipped malformed ledger line(s) (not uploaded)" >&2; fi
valid_lines "$work/all" | sort -t "$(printf '\t')" -k2,2 \
  | awk -F'\t' -v u="$upload_from" -v dir="$work/days" '{ d = substr($2, 1, 10) } d >= u { if (d != last) { if (last != "") close(f); f = dir "/" d; last = d } print > f }'
touch "$work/days/$today"
while IFS= read -r o; do # an object of a day still uploaded with no line of its own day is rewritten empty
  d="$(day_of "$o")" || continue
  if [[ ! "$d" < "$upload_from" ]]; then touch "$work/days/$d"; fi
done <<< "$listing"
unchanged=0
for f in "$work"/days/*; do
  obj="erasures-${f##*/}.log"
  sort -u "$f" > "$work/merged"
  if in_bucket "$obj" && { grep -v '^$' "$work/bucket/$obj" || true; } | sort -u | cmp -s - "$work/merged"; then
    unchanged=$((unchanged + 1))
  else
    # .partial first, renamed only after the whole upload succeeded (as backup.sh does)
    # (a per-run suffix: a manual run overlapping the cron run must not share the name)
    rclone rcat "$ledger_dest/$obj.partial.$$" < "$work/merged"
    rclone moveto "$ledger_dest/$obj.partial.$$" "$ledger_dest/$obj" < /dev/null
    echo "ledger uploaded: $obj ($(wc -l < "$work/merged" | tr -d ' ') entries)"
  fi
done
echo "ledger unchanged: $unchanged day object(s)"

# 4. the 45-day snapshots of the first ledger version: their entries are in the day objects now
if [ "${#old_objects[@]}" -gt 0 ]; then
  for o in "${old_objects[@]}"; do rclone deletefile "$ledger_dest/$o" < /dev/null; done
  echo "split ${#old_objects[@]} snapshot object(s) into day objects and deleted them"
fi

# 5. day objects past retention by their day, then any object (and stale .partial file) older than the retention
while IFS= read -r o; do
  d="$(day_of "$o")" || continue
  if [[ "$d" < "$keep_from" ]]; then
    rclone deletefile "$ledger_dest/$o" < /dev/null
    echo "deleted day object $o (more than $ledger_retention_days days old)"
  fi
done <<< "$listing"
rclone delete --min-age "${ledger_retention_days}d" "$ledger_dest"

if [ -n "${LEDGER_HEARTBEAT_URL:-}" ]; then
  printf 'url = "%s"\n' "$LEDGER_HEARTBEAT_URL" | curl -fsS -m 10 --retry 3 -o /dev/null -K - \
    || echo "warning: heartbeat ping failed (the upload itself succeeded)" >&2
fi
