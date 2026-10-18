#!/usr/bin/env bash
# Runs check-caddy-access-log.sh on the real Caddyfiles (must pass) and on copies with one privacy filter or pinned
# value changed at a time (must fail). Run from anywhere: infra/scripts/test-check-caddy-access-log.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

"$here/check-caddy-access-log.sh" > "$tmp/out" 2>&1 || fail "committed files do not pass: $(cat "$tmp/out")"

# mutate <kind> <label> <sed script>: the check must fail on a copy changed by the script, and the script must change it
mutate() {
  local kind="$1" label="$2" script="$3" src="$root/infra/caddy/Caddyfile.$1"
  sed "$script" "$src" > "$tmp/c"
  ! cmp -s "$src" "$tmp/c" || fail "$kind: mutation '$label' changed nothing"
  if "$here/check-caddy-access-log.sh" "$kind=$tmp/c" > "$tmp/out" 2>&1; then fail "$kind passed with: $label"; fi
}
for kind in api stack; do
  mutate "$kind" "barcode redaction removed" '/foods\/barcode/d'
  mutate "$kind" "barcode redaction not case-insensitive" 's/(?i)//'
  mutate "$kind" "barcode redaction replacement changed" 's/{code}/x/'
done
for kind in api web stack; do
  mutate "$kind" "ipv4 32" 's/ipv4 24/ipv4 32/'
  mutate "$kind" "ipv6 128" 's/ipv6 48/ipv6 128/'
  mutate "$kind" "empty ip_mask" '/ip_mask {/,/^[[:space:]]*}/{/ipv[46]/d;}'
  mutate "$kind" "remote_ip filter removed" '/request>remote_ip ip_mask/,/^[[:space:]]*}/d'
  mutate "$kind" "client_ip filter removed" '/request>client_ip ip_mask/,/^[[:space:]]*}/d'
  mutate "$kind" "query cut removed" '/request>uri regexp/d'
  mutate "$kind" "request headers kept" '/request>headers delete/d'
  mutate "$kind" "response headers kept" '/resp_headers delete/d'
  mutate "$kind" "wrap json removed" '/wrap json/d'
  mutate "$kind" "headers delete commented out" 's/^\([[:space:]]*\)request>headers delete/\1# request>headers delete/'
  mutate "$kind" "log_credentials" 's/format filter {/log_credentials\n\t\tformat filter {/'
done
for kind in api web; do
  mutate "$kind" "retention 87600h" 's/336h/87600h/'
  mutate "$kind" "retention removed" '/roll_keep_for/d'
  mutate "$kind" "roll_interval removed" '/roll_interval/d'
  mutate "$kind" "roll_interval 720h" 's/roll_interval 24h/roll_interval 720h/'
  mutate "$kind" "roll_keep 1000" 's/roll_keep 15/roll_keep 1000/'
  mutate "$kind" "roll_size removed" '/roll_size/d'
  mutate "$kind" "file output removed" 's/output file .*{/output stderr {/'
done
mutate stack "error log not included" '/include http.log.error/d'

# The barcode regexp (taken from the Caddyfiles, Go RE2 syntax that Python's re reads the same way) on sample URIs.
# Caddy runs the query cut first, then this one; the same order is applied here.
for kind in api stack; do
  python3 -I - "$root/infra/caddy/Caddyfile.$kind" <<'PY' || fail "$kind: barcode regexp samples"
import re, sys
text = open(sys.argv[1]).read()
cut = re.search(r'request>uri regexp "(\\\?\.\*\$)" ""', text)
m = re.search(r'request>uri regexp "(\(\?i\)\(/foods/barcode/\)[^"]*)" "\$\{1\}\{code\}"', text)
if not (cut and m):
    sys.exit("filters not found")
c, p = re.compile(cut.group(1)), re.compile(m.group(1))
B = "/foods/barcode/{code}"
want = {
    "/api/v1/foods/barcode/5449000000996": "/api/v1/foods/barcode/{code}",
    "/api/v1/foods/barcode/5449000000996/": "/api/v1/foods/barcode/{code}",
    "/api/v1/foods/barcode/5449000000996///": "/api/v1/foods/barcode/{code}",
    "/api/v1/foods/barcode/5449000000996?a=1": "/api/v1/foods/barcode/{code}",
    "/api/v1/foods/barcode/5449000000996/?a=1": "/api/v1/foods/barcode/{code}",
    "/API/V1/FOODS/BARCODE/5449000000996": "/API/V1/FOODS/BARCODE/{code}",
    "/api/v1/Foods/Barcode/04252614": "/api/v1/Foods/Barcode/{code}",
    "/foods/barcode/012345678905": B,
    "/v2/api/v1/foods/barcode/012345678905": "/v2/api/v1/foods/barcode/{code}",
    "https://h/api/v1/foods/barcode/012345678905": "https://h/api/v1/foods/barcode/{code}",
    "/api/v1/foods": "/api/v1/foods",
    "/api/v1/foods?q=5449000000996": "/api/v1/foods",
    "/api/v1/foods/barcode/": "/api/v1/foods/barcode/",
    "/api/v1/health": "/api/v1/health",
}
bad = []
for uri, exp in want.items():
    got = p.sub(r"\1{code}", c.sub("", uri))
    if got != exp or re.search(r"[0-9]{8}", got.replace("/api/v1", "")):
        bad.append("%s -> %s, want %s" % (uri, got, exp))
if bad:
    sys.exit("\n".join(bad))
PY
done
echo "check-caddy-access-log tests passed"
