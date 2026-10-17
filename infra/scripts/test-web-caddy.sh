#!/usr/bin/env bash
# Runs the pinned official Caddy image with infra/caddy/Caddyfile.web over a fixture export and asserts what a browser
# gets: COOP same-origin and COEP require-corp on every response (including the SPA fallback), a long immutable cache
# for hashed assets, no-cache for index.html and everything else, index.html for unknown routes, and a 404 (not index.html, not
# immutable) for a missing hashed asset. Needs Docker. Run from anywhere: infra/scripts/test-web-caddy.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
image="caddy:2.11.7" # keep in step with infra/staging/docker-compose.yml
tmp="$(mktemp -d)"
cid=""
cleanup() { [ -z "$cid" ] || docker rm -f "$cid" > /dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; exit 1; }

mkdir -p "$tmp/web/_expo/static/js/web" "$tmp/web/assets" "$tmp/web/licenses"
echo '<html>index</html>' > "$tmp/web/index.html"
echo 'console.log(1)' > "$tmp/web/_expo/static/js/web/entry-abc123.js"
echo 'png' > "$tmp/web/assets/0123abcd.png"
echo 'MIT' > "$tmp/web/licenses/a.txt"
chmod -R a+rX "$tmp/web"

# a plain-HTTP address: no certificate is requested in the test; everything else is the real file
cid="$(docker run -d -p 127.0.0.1::8081 -e 'WEB_HOST=http://:8081' \
  -v "$here/../caddy/Caddyfile.web:/etc/caddy/Caddyfile:ro" -v "$tmp/web:/srv/web:ro" "$image")"
port="$(docker port "$cid" 8081/tcp | head -n 1 | sed 's/.*://')"
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$port/" && break
  sleep 1
done

# get <path>: headers (lower-cased names) into $tmp/h, body into $tmp/b, status in $status
get() {
  status="$(curl -s -D "$tmp/h.raw" -o "$tmp/b" -w '%{http_code}' "http://127.0.0.1:$port$1")"
  tr -d '\r' < "$tmp/h.raw" | tr '[:upper:]' '[:lower:]' > "$tmp/h"
}
hdr() { grep -q "^$1: $2\$" "$tmp/h" || fail "$path: expected '$1: $2', got: $(grep "^$1:" "$tmp/h" || echo none)"; }
iso() { hdr cross-origin-opener-policy same-origin; hdr cross-origin-embedder-policy require-corp; }

path=/; get "$path"; [ "$status" = 200 ] || fail "$path: status $status"
iso; hdr cache-control no-cache; grep -q index "$tmp/b" || fail "$path: not index.html"
path=/index.html; get "$path"; [ "$status" = 200 ] || fail "$path: status $status"; hdr cache-control no-cache
path=/_expo/static/js/web/entry-abc123.js; get "$path"; [ "$status" = 200 ] || fail "$path: status $status"
iso; hdr cache-control 'public, max-age=31536000, immutable'
path=/assets/0123abcd.png; get "$path"; [ "$status" = 200 ] || fail "$path: status $status"
hdr cache-control 'public, max-age=31536000, immutable'
path=/licenses/a.txt; get "$path"; [ "$status" = 200 ] || fail "$path: status $status"; hdr cache-control no-cache
# SPA fallback: deep link serves index.html with the isolation headers and revalidates
path=/workout/today; get "$path"; [ "$status" = 200 ] || fail "$path: status $status"
grep -q index "$tmp/b" || fail "$path: no SPA fallback"; iso; hdr cache-control no-cache
# a missing hashed asset is a 404 (not index.html) and must not be cached for a year
for path in /assets/missing.png /_expo/static/js/web/entry-gone.js; do
  get "$path"; [ "$status" = 404 ] || fail "$path: status $status, expected 404"
  ! grep -q index "$tmp/b" || fail "$path: served index.html"
  ! grep -q immutable "$tmp/h" || fail "$path: 404 marked immutable"
done
echo "Caddyfile.web serving tests passed"
