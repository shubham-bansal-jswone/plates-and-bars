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
ecid=""
wcid=""
cleanup() { for c in "$cid" "$ecid" "$wcid"; do [ -z "$c" ] || docker rm -f "$c" > /dev/null 2>&1 || true; done; rm -rf "$tmp"; }
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
# (the headers come from a file so the fixture value is not a curl -H literal that secret scanners flag)
printf 'Authorization: Bearer sekrit-token\nCookie: refresh=sekrit-cookie\nX-Forwarded-For: 203.0.113.77\n' > "$tmp/req-headers"
curl -s -o /dev/null -H "@$tmp/req-headers" "http://127.0.0.1:$port/probe-path?email=sekrit%40example.com"
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
# Error log (#714): the stack file, with the API upstream down, answers a probe with 502 or 503; Caddy's own error line for it
# (stderr) must not hold the raw IP, the query string, or the User-Agent and X-Forwarded-For headers
ecid="$(docker run -d -p 127.0.0.1::8082 -e 'API_HOST=http://:8082' -e 'WEB_HOST=http://:8081' -e API_UPSTREAM=127.0.0.1:9 \
  -v "$here/../caddy:/etc/caddy/sites:ro" -v "$tmp/web:/srv/web:ro" "$image" caddy run --config /etc/caddy/sites/Caddyfile.stack --adapter caddyfile)"
eport="$(docker port "$ecid" 8082/tcp | head -n 1 | sed 's/.*://')"
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$eport/nothing" && break
  sleep 1
done
printf 'User-Agent: sekrit-agent\nX-Forwarded-For: 203.0.113.77\n' > "$tmp/err-headers"
estatus="$(curl -s -o /dev/null -w '%{http_code}' -H "@$tmp/err-headers" "http://127.0.0.1:$eport/api/v1/probe-err?email=sekrit%40example.com")"
case "$estatus" in 502|503) ;; *) fail "error probe: status $estatus, expected 502 or 503 (upstream down)" ;; esac
elines=""
for _ in $(seq 1 10); do
  elines="$(docker logs "$ecid" 2>&1 | grep '"level":"error"' | grep probe-err || true)"
  [ -z "$elines" ] || break
  sleep 1
done
[ -n "$elines" ] || fail "error log: no error line for /api/v1/probe-err in docker logs"
# every matching line is checked, not only the first
while IFS= read -r eline; do
  case "$eline" in *'"uri":"/api/v1/probe-err"'*) ;; *) fail "error log: uri is not the bare path: $eline" ;; esac
  for secret in sekrit 203.0.113 sekrit-agent; do
    case "$eline" in *"$secret"*) fail "error log leaks '$secret': $eline" ;; esac
  done
  printf '%s' "$eline" | grep -Eq '"remote_ip":"[0-9]+\.[0-9]+\.[0-9]+\.0"' || fail "error log: remote_ip not masked: $eline"
done <<< "$elines"
# Barcode (#944): a lookup with the upstream down (a query, typed junk after the barcode, an encoded digit, extra path, upper case) must leave
# /foods/barcode/{code} in the error line and in the API access line, never the barcode, and with the IP masked
for bpath in '/api/v1/foods/barcode/5449000000996?x=1' '/api/v1/foods/barcode/5449000000996abc' '/API/V1/Foods/Barcode/%355449000000996/extra'; do
  bstatus="$(curl -s -o /dev/null -w '%{http_code}' -H "@$tmp/err-headers" "http://127.0.0.1:$eport$bpath")"
  case "$bstatus" in 502|503) ;; *) fail "barcode probe $bpath: status $bstatus, expected 502 or 503 (upstream down)" ;; esac
done
blines=""
for _ in $(seq 1 10); do
  blines="$( { docker logs "$ecid" 2>&1 | grep '"level":"error"' | grep -i 'foods/barcode' || true; docker exec "$ecid" grep -i 'foods/barcode' /data/api_access.log 2> /dev/null || true; } )"
  [ "$(printf '%s\n' "$blines" | grep -c .)" -ge 6 ] && break
  sleep 1
done
[ "$(printf '%s\n' "$blines" | grep -c .)" -ge 6 ] || fail "barcode probe: expected 3 error lines and 3 access lines, got: $blines"
while IFS= read -r bline; do
  [ -n "$bline" ] || continue
  printf '%s' "$bline" | grep -Eqi '"uri":"/api/v1/foods/barcode/\{code\}"' || fail "barcode log: uri is not /foods/barcode/{code}: $bline"
  for secret in 5449 203.0.113 sekrit x=1; do
    case "$bline" in *"$secret"*) fail "barcode log leaks '$secret': $bline" ;; esac
  done
  printf '%s' "$bline" | grep -Eq '"remote_ip":"[0-9]+\.[0-9]+\.[0-9]+\.0"' || fail "barcode log: remote_ip not masked: $bline"
done <<< "$blines"
# Cut-off upstream response (the reverse_proxy WARN "aborting with incomplete response") and Hosts that are not in Caddy's per-host
# log map (upper case, an unknown host): both lines carry the request and must be filtered like the access log. The upstream is a
# busybox nc loop inside the container: /api/v1/health gets a full 200, everything else announces 100000 bytes and sends 3.
cat > "$tmp/upstream.sh" <<'SH'
#!/bin/sh
read -r line
while read -r h; do [ "$h" = "$(printf '\r')" ] && break; [ -z "$h" ] && break; done
case "$line" in
  *"/api/v1/health"*) printf 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok' ;;
  *) printf 'HTTP/1.1 200 OK\r\nContent-Length: 100000\r\nConnection: close\r\n\r\nabc' ;;
esac
SH
chmod a+rx "$tmp/upstream.sh"
wcid="$(docker run -d -p 127.0.0.1::8083 -e 'API_HOST=http://api.test:8083' -e 'WEB_HOST=http://:8084' -e API_UPSTREAM=127.0.0.1:9000 \
  -v "$here/../caddy:/etc/caddy/sites:ro" -v "$tmp/web:/srv/web:ro" -v "$tmp/upstream.sh:/upstream.sh:ro" --entrypoint sh "$image" \
  -c 'while true; do nc -l -p 9000 -e /bin/sh /upstream.sh; done & exec caddy run --config /etc/caddy/sites/Caddyfile.stack --adapter caddyfile')"
wport="$(docker port "$wcid" 8083/tcp | head -n 1 | sed 's/.*://')"
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$wport/nothing" && break
  sleep 1
done
sleep 2 # the first health check of the upstream
for host in api.test:8083 API.TEST:8083 other.test:8083; do
  printf 'Host: %s\nUser-Agent: sekrit-agent\nX-Forwarded-For: 203.0.113.77\n' "$host" > "$tmp/w-headers"
  curl -s -o /dev/null -H "@$tmp/w-headers" "http://127.0.0.1:$wport/api/v1/foods/barcode/5449000000996?h=1" || true # the cut-off body makes curl exit 18
done
wlines=""
for _ in $(seq 1 10); do
  wlines="$(docker logs "$wcid" 2>&1 | grep -E '"logger":"(http.handlers.reverse_proxy|http.log.access)"' | grep -F 'foods/barcode' || true)"
  [ "$(printf '%s\n' "$wlines" | grep -c .)" -ge 4 ] && break
  sleep 1
done
# 2 cut-off WARN lines (api.test, API.TEST) and 3 default-log access lines (the mapped host is in api_access.log, not here: 2 here)
printf '%s\n' "$wlines" | grep -q 'aborting with incomplete response' || fail "reverse_proxy WARN: no 'aborting with incomplete response' line: $wlines"
printf '%s\n' "$wlines" | grep -q '"logger":"http.log.access"' || fail "default log: no access line for the unmapped hosts: $wlines"
while IFS= read -r wline; do
  [ -n "$wline" ] || continue
  printf '%s' "$wline" | grep -Eq '"uri":"/api/v1/foods/barcode/\{code\}"' || fail "reverse_proxy/default log: uri is not /foods/barcode/{code}: $wline"
  for secret in 5449 203.0.113 sekrit h=1; do
    case "$wline" in *"$secret"*) fail "reverse_proxy/default log leaks '$secret': $wline" ;; esac
  done
  printf '%s' "$wline" | grep -Eq '"remote_ip":"[0-9]+\.[0-9]+\.[0-9]+\.0"' || fail "reverse_proxy/default log: remote_ip not masked: $wline"
done <<< "$wlines"
echo "Caddyfile.stack error log tests passed"
echo "Caddyfile.web serving tests passed"
