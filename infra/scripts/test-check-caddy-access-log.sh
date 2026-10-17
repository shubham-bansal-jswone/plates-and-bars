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
echo "check-caddy-access-log tests passed"
