#!/usr/bin/env bash
# Runs check-caddy-headers.sh against copies of the real files: it passes as committed, and fails when the HSTS line
# is removed from Caddyfile.api, commented out, set to max-age=0, or present only outside the header block; and when
# Caddyfile.site drifts from _headers. Run from anywhere: infra/scripts/test-check-caddy-headers.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
fresh() {
  rm -rf "$tmp/t"; mkdir -p "$tmp/t/infra/scripts" "$tmp/t/infra/caddy" "$tmp/t/apps/site/public"
  cp "$here/check-caddy-headers.sh" "$tmp/t/infra/scripts/"
  cp "$root"/infra/caddy/Caddyfile.* "$tmp/t/infra/caddy/"
  cp "$root/apps/site/public/_headers" "$tmp/t/apps/site/public/"
}
check() { "$tmp/t/infra/scripts/check-caddy-headers.sh" > "$tmp/out" 2>&1; }

fresh
check || fail "committed files do not pass: $(cat "$tmp/out")"

fresh
grep -v '^[[:space:]]*Strict-Transport-Security' "$tmp/t/infra/caddy/Caddyfile.api" > "$tmp/api" && cat "$tmp/api" > "$tmp/t/infra/caddy/Caddyfile.api"
if check; then fail "passed with HSTS removed from Caddyfile.api"; fi
grep -q 'Caddyfile.api no longer sets Strict-Transport-Security with a positive max-age' "$tmp/out" || fail "wrong error: $(cat "$tmp/out")"

fresh
sed 's/^\([[:space:]]*\)Strict-Transport-Security/\1# Strict-Transport-Security/' "$tmp/t/infra/caddy/Caddyfile.api" > "$tmp/api" && cat "$tmp/api" > "$tmp/t/infra/caddy/Caddyfile.api"
if check; then fail "passed with HSTS commented out in Caddyfile.api"; fi

fresh
sed 's/max-age=31536000/max-age=0/' "$tmp/t/infra/caddy/Caddyfile.api" > "$tmp/api" && cat "$tmp/api" > "$tmp/t/infra/caddy/Caddyfile.api"
if check; then fail "passed with max-age=0 in Caddyfile.api"; fi

# HSTS only outside the header block (a whole-file grep would accept this)
fresh
grep -v '^[[:space:]]*Strict-Transport-Security' "$tmp/t/infra/caddy/Caddyfile.api" > "$tmp/api"
printf '\nexample.org {\n\tStrict-Transport-Security "max-age=31536000"\n}\n' >> "$tmp/api"
cat "$tmp/api" > "$tmp/t/infra/caddy/Caddyfile.api"
if check; then fail "passed with HSTS only outside the header block"; fi

fresh
sed 's/nosniff/sniff/' "$tmp/t/infra/caddy/Caddyfile.site" > "$tmp/site" && cat "$tmp/site" > "$tmp/t/infra/caddy/Caddyfile.site"
if check; then fail "passed with Caddyfile.site drifted from _headers"; fi

echo "check-caddy-headers.sh tests passed"
