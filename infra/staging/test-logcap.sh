#!/usr/bin/env bash
# Runs logcap.sh on a fake /var/lib/docker/containers tree: rotated files 13+ days old are deleted, newer ones kept; the
# active file is emptied when there is no stamp or the stamp is 13+ days old, kept otherwise. No Docker needed.
# Run from anywhere: infra/staging/test-logcap.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
# touch -t stamp for N days ago (GNU date, then BSD date)
ago() { local t=$(( $(date +%s) - $1 * 86400 )); date -u -d "@$t" +%Y%m%d%H%M 2> /dev/null || date -u -r "$t" +%Y%m%d%H%M; }

c="$tmp/containers"
mk() { # <id>: three rotated files and an active file with content
  mkdir -p "$c/$1/local-logs"
  for f in container.log.1.gz container.log.2.gz container.log.3.gz container.log; do echo data > "$c/$1/local-logs/$f"; done
  echo '{}' > "$c/$1/config.v2.json"
}
mk aaa; mk bbb; mk ccc
mkdir -p "$c/ddd"; echo "x-json" > "$c/ddd/ddd-json.log"   # another driver: untouched
touch -t "$(ago 20)" "$c/aaa/local-logs/container.log.3.gz"
touch -t "$(ago 14)" "$c/aaa/local-logs/container.log.2.gz"
touch -t "$(ago 5)" "$c/aaa/local-logs/container.log.1.gz"

# first run: no stamps, so every active file is emptied and stamped; rotated files are cut by age
"$here/logcap.sh" "$c" > "$tmp/out"
[ ! -e "$c/aaa/local-logs/container.log.3.gz" ] || fail "20-day-old rotated file kept"
[ ! -e "$c/aaa/local-logs/container.log.2.gz" ] || fail "14-day-old rotated file kept"
[ -e "$c/aaa/local-logs/container.log.1.gz" ] || fail "5-day-old rotated file deleted"
[ -e "$c/bbb/local-logs/container.log.1.gz" ] || fail "fresh rotated file deleted"
for id in aaa bbb ccc; do
  [ ! -s "$c/$id/local-logs/container.log" ] || fail "$id: active file not emptied without a stamp"
  [ -f "$c/$id/logcap.stamp" ] || fail "$id: no stamp"
done
grep -q 'emptied' "$tmp/out" || fail "no output line for an emptied file"
[ "$(cat "$c/ddd/ddd-json.log")" = x-json ] || fail "a json-file log was touched"
[ -e "$c/aaa/config.v2.json" ] || fail "container config touched"

# second run, stamps are fresh: active files are kept
echo more > "$c/aaa/local-logs/container.log"
"$here/logcap.sh" "$c" > "$tmp/out"
[ -s "$c/aaa/local-logs/container.log" ] || fail "active file emptied while the stamp is fresh"
[ ! -s "$tmp/out" ] || fail "output when nothing was emptied: $(cat "$tmp/out")"

# stamp 5 days old: kept; 20 days old: emptied and the stamp renewed
touch -t "$(ago 5)" "$c/aaa/logcap.stamp"
"$here/logcap.sh" "$c" > /dev/null
[ -s "$c/aaa/local-logs/container.log" ] || fail "active file emptied with a 5-day-old stamp"
touch -t "$(ago 20)" "$c/aaa/logcap.stamp"
"$here/logcap.sh" "$c" > /dev/null
[ ! -s "$c/aaa/local-logs/container.log" ] || fail "active file kept with a 20-day-old stamp"
[ -z "$(find "$c/aaa/logcap.stamp" -mtime +0)" ] || fail "stamp not renewed"

# an empty tree and a missing argument
mkdir "$tmp/none"; "$here/logcap.sh" "$tmp/none"
if "$here/logcap.sh" > /dev/null 2>&1; then fail "accepted no argument"; fi
echo "logcap.sh tests passed"
