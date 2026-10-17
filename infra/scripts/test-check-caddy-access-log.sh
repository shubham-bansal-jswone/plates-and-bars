#!/usr/bin/env bash
# Runs check-caddy-access-log.sh on the real Caddyfiles (must pass) and on copies with one privacy filter removed
# at a time (must fail). Run from anywhere: infra/scripts/test-check-caddy-access-log.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

"$here/check-caddy-access-log.sh" > "$tmp/out" 2>&1 || fail "committed files do not pass: $(cat "$tmp/out")"

for f in api web; do
  src="$root/infra/caddy/Caddyfile.$f"
  for pat in 'request>remote_ip ip_mask' 'request>client_ip ip_mask' 'request>remote_addr ip_mask' 'request>uri regexp' \
    'request>headers delete' 'resp_headers delete' 'roll_keep_for' 'roll_size' 'wrap json' 'output file'; do
    # a block of lines starting with the pattern is cut: the ip_mask pattern leaves its { } body, which is harmless to the check
    grep -vF -- "$pat" "$src" > "$tmp/c"
    if "$here/check-caddy-access-log.sh" "$tmp/c" > "$tmp/out" 2>&1; then fail "Caddyfile.$f passed without: $pat"; fi
  done
  # a commented-out filter does not count
  sed 's/^\([[:space:]]*\)request>headers delete/\1# request>headers delete/' "$src" > "$tmp/c"
  if "$here/check-caddy-access-log.sh" "$tmp/c" > "$tmp/out" 2>&1; then fail "Caddyfile.$f passed with headers delete commented out"; fi
  # no log at all
  grep -v '^[[:space:]]*#' "$src" | awk '/^[[:space:]]*log /{skip=1} !skip{print} skip && /^\t\}$/{skip=0}' > "$tmp/c"
  if "$here/check-caddy-access-log.sh" "$tmp/c" > "$tmp/out" 2>&1; then fail "Caddyfile.$f passed without a log block"; fi
done
echo "check-caddy-access-log tests passed"
