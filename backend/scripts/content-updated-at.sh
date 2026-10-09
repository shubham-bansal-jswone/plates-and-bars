#!/bin/sh
# Prints CONTENT_UPDATED_AT for the content bundles: name=timestamp pairs, comma separated, one per content/*.json.
# Each timestamp is the committer date of `git log -1 --format=%cI -- content/<name>.json` in UTC.
#
#   backend/scripts/content-updated-at.sh            print the value (run in a FULL-history checkout of main)
#   backend/scripts/content-updated-at.sh --check V  exit 1 unless V has a valid timestamp for every content/*.json
#
# Fails (never falls back to the build time) on a shallow clone, a file with no commit, or a missing value.
# Run from anywhere; the repository root is found from this script's location.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
ts_re='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})'

if [ "${1:-}" = "--check" ]; then
  value=${2:-}
  [ -n "$value" ] || { echo "CONTENT_UPDATED_AT is empty: pass --build-arg CONTENT_UPDATED_AT=\"\$(backend/scripts/content-updated-at.sh)\"" >&2; exit 1; }
  for f in "$root"/content/*.json; do
    name=$(basename "$f" .json)
    echo ",$value," | grep -Eq ",[[:space:]]*$name=$ts_re[[:space:]]*," \
      || { echo "CONTENT_UPDATED_AT has no valid timestamp for content/$name.json" >&2; exit 1; }
  done
  exit 0
fi

cd "$root"
[ "$(git rev-parse --is-shallow-repository)" = "false" ] \
  || { echo "shallow clone: content updated_at needs full history (git fetch --unshallow)" >&2; exit 1; }
out=""
for f in content/*.json; do
  name=$(basename "$f" .json)
  ts=$(TZ=UTC git log -1 --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd -- "$f")
  [ -n "$ts" ] || { echo "no commit found for $f" >&2; exit 1; }
  out="$out${out:+,}$name=$ts"
done
printf '%s\n' "$out"
