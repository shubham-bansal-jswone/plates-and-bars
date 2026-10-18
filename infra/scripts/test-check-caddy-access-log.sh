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
  mutate "$kind" "barcode redaction back to digits only" 's/(?:\/|%2f).+\$/\/[0-9]+\/*$/'
  mutate "$kind" "barcode redaction without the encoded slash" 's/|%2f//'
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
mutate stack "reverse_proxy logger not included" 's/ http.handlers.reverse_proxy//'
mutate stack "reverse_proxy logger included alone" 's/include http.log.error http.handlers.reverse_proxy/include http.handlers.reverse_proxy/'
# glitchtip=<file>: same generic pins plus the error-log include; no barcode pin (the real file has no barcode rule)
"$here/check-caddy-access-log.sh" "glitchtip=$root/infra/caddy/Caddyfile.glitchtip" > "$tmp/out" 2>&1 || fail "glitchtip file does not pass: $(cat "$tmp/out")"
for script in 's/ http.handlers.reverse_proxy//' '/request>client_ip ip_mask/,/^[[:space:]]*}/d' 's/336h/87600h/'; do
  sed "$script" "$root/infra/caddy/Caddyfile.glitchtip" > "$tmp/c"
  if "$here/check-caddy-access-log.sh" "glitchtip=$tmp/c" > "$tmp/out" 2>&1; then fail "glitchtip passed with: $script"; fi
done

# The barcode regexp, read from the real Caddyfiles (Go RE2; Python's re reads this pattern the same way), on sample URIs,
# with the two URI rules applied in BOTH orders: the rule must not depend on running after the query cut.
for kind in api stack; do
  python3 -I - "$root/infra/caddy/Caddyfile.$kind" <<'PY' || fail "$kind: barcode regexp samples"
import re, sys
text = open(sys.argv[1]).read()
cut = re.search(r'request>uri regexp "(\\\?\.\*\$)" ""', text)
m = re.search(r'request>uri regexp "(\(\?i\)\(/foods/barcode\)[^"]*)" "\$\{1\}/\{code\}"', text)
if not (cut and m):
    sys.exit("filters not found")
c, p = re.compile(cut.group(1)), re.compile(m.group(1))
R = "/api/v1/foods/barcode/{code}"
want = {
    "/api/v1/foods/barcode/5449000000996": R,
    "/api/v1/foods/barcode/5449000000996/": R,
    "/api/v1/foods/barcode/5449000000996///": R,
    "/api/v1/foods/barcode/5449000000996?a=1": R,
    "/api/v1/foods/barcode/5449000000996/?a=1": R,
    "/API/V1/FOODS/BARCODE/5449000000996": "/API/V1/FOODS/BARCODE/{code}",
    "/api/v1/Foods/Barcode/04252614": "/api/v1/Foods/Barcode/{code}",
    "/foods/barcode/012345678905": "/foods/barcode/{code}",
    "/v2/api/v1/foods/barcode/012345678905": "/v2/api/v1/foods/barcode/{code}",
    "https://h/api/v1/foods/barcode/012345678905": "https://h/api/v1/foods/barcode/{code}",
    # typed junk, encoded and extra parts all go
    "/api/v1/foods/barcode/1234abc": R,
    "/api/v1/foods/barcode/5449000000996%20": R,
    "/api/v1/foods/barcode/%35449000000996": R,
    "/api/v1/foods/barcode/5449000000996;jsessionid=x": R,
    "/api/v1/foods/barcode/5449000000996/extra": R,
    "/api/v1/foods/barcode/5449%2F000000996": R,
    "/api/v1/foods/barcode%2F5449000000996": R,
    "/api/v1/foods/barcode%2f5449000000996": R,
    "/api/v1/foods/barcode/5449000000996?email=a@b.c": R,
    # left alone
    "/api/v1/foods/barcode/": "/api/v1/foods/barcode/",
    "/api/v1/foods/barcode": "/api/v1/foods/barcode",
    "/api/v1/foods": "/api/v1/foods",
    "/foods": "/foods",
    "/api/v1/foods?q=5449000000996": "/api/v1/foods",
    "/api/v1/health": "/api/v1/health",
}
orders = {"cut then barcode": lambda u: p.sub(r"\1/{code}", c.sub("", u)),
          "barcode then cut": lambda u: c.sub("", p.sub(r"\1/{code}", u))}
bad = []
for name, run in orders.items():
    for uri, exp in want.items():
        got = run(uri)
        if got != exp or re.search(r"[0-9]{4}", got.replace("/api/v1", "")):
            bad.append("%s: %s -> %s, want %s" % (name, uri, got, exp))
if bad:
    sys.exit("\n".join(bad))
PY
done
echo "check-caddy-access-log tests passed"
