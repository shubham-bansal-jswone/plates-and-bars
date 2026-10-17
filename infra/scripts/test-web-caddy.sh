#!/usr/bin/env bash
# Runs the pinned official Caddy image with infra/caddy/Caddyfile.web over a fixture export and asserts what a browser
# gets: COOP same-origin, COEP require-corp and the Content-Security-Policy on every response (including the SPA fallback), a long immutable cache
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
cid="$(docker run -d -p 127.0.0.1::8081 -e 'WEB_HOST=http://:8081' -e API_HOST=api.test -e SENTRY_ORIGIN=https://errors.test \
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
iso() { hdr cross-origin-opener-policy same-origin; hdr cross-origin-embedder-policy require-corp; csp; }
# the policy: script-src is exactly self plus wasm (no inline, no eval), the API host (API_HOST) and the error-tracking origin (SENTRY_ORIGIN) in connect-src only
csp() {
  local v; v="$(grep '^content-security-policy:' "$tmp/h" || true)"
  [ -n "$v" ] || fail "$path: no Content-Security-Policy"
  case "$v" in *"script-src 'self' 'wasm-unsafe-eval';"*) ;; *) fail "$path: script-src: $v" ;; esac
  case "$v" in *"connect-src 'self' https://api.test https://errors.test;"*) ;; *) fail "$path: connect-src: $v" ;; esac
  case "$v" in *"default-src 'self';"*"object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"*) ;; *) fail "$path: closed directives: $v" ;; esac
}

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
# Access log (#714): a request carrying a query string, Authorization, Cookie and X-Forwarded-For leaves one JSON line with
# the path but none of those values, and the client IP is masked (the last IPv4 octet is 0)
curl -s -o /dev/null -H 'Authorization: Bearer sekrit-token' -H 'Cookie: refresh=sekrit-cookie' -H 'X-Forwarded-For: 203.0.113.77' \
  "http://127.0.0.1:$port/probe-path?email=sekrit%40example.com"
line=""
for _ in $(seq 1 10); do
  line="$(docker exec "$cid" grep probe-path /data/web_access.log 2> /dev/null | head -n 1 || true)"
  [ -z "$line" ] || break
  sleep 1
done
[ -n "$line" ] || fail "access log: no line for /probe-path in /data/web_access.log"
case "$line" in "{"*"}") ;; *) fail "access log line is not JSON: $line" ;; esac
case "$line" in *'"uri":"/probe-path"'*) ;; *) fail "access log: uri is not the bare path: $line" ;; esac
for secret in sekrit 203.0.113 'Bearer' 'refresh='; do
  case "$line" in *"$secret"*) fail "access log leaks '$secret': $line" ;; esac
done
printf '%s' "$line" | grep -Eq '"remote_ip":"[0-9]+\.[0-9]+\.[0-9]+\.0"' || fail "access log: remote_ip not masked: $line"
echo "Caddyfile.web serving tests passed"
