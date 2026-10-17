#!/usr/bin/env bash
# Fails if a header in apps/site/public/_headers is missing from, or differs in, infra/caddy/Caddyfile.site
# (Caddy ignores _headers; the site CSP and security headers are kept in both places), likewise for
# apps/mobile/public/_headers (COOP, COEP and the CSP; Caddy's {$ENV:default} placeholders count as their default) and infra/caddy/Caddyfile.web, or if the header block of
# infra/caddy/Caddyfile.api no longer sets Strict-Transport-Security with a positive max-age (max-age=0 switches HSTS off).
# Usage: infra/scripts/check-caddy-headers.sh   (from anywhere)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
caddy_api="$root/infra/caddy/Caddyfile.api"

# compare <_headers file> <Caddyfile>: every header of _headers must be in the Caddyfile's header { } block, same value
compare() {
  local headers="$1" caddy="$2" rel want have line st=0
  rel="${caddy#"$root"/}"
  # "  Name: value" in _headers -> "name|value"
  want="$(sed -n 's/^[[:space:]][[:space:]]*\([A-Za-z-][A-Za-z-]*\):[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1|\2/p' "$headers" | awk -F'|' '{ n=tolower($1); sub(/^[^|]*\|/, ""); print n "|" $0 }')"
  [ -n "$want" ] || { echo "::error::no headers parsed from $headers"; return 1; }
  # Caddyfile: lines inside the header { } block, "Name value" or Name "value" -> "name|value"
  have="$(awk '/^[[:space:]]*header[[:space:]]*\{/ {on=1; next} on && /^[[:space:]]*\}/ {on=0} on {print}' "$caddy" \
    | sed -n 's/^[[:space:]]*\([A-Za-z-][A-Za-z-]*\)[[:space:]][[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1|\2/p' \
    | awk -F'|' '{ n=tolower($1); sub(/^[^|]*\|/, ""); v=$0; if (v ~ /^".*"$/) v=substr(v,2,length(v)-2); print n "|" v }' \
    | sed -e 's/{\$[A-Z_]*:\([^}]*\)}/\1/g' -e 's/ ;/;/g')" # {$ENV:default} -> default; an empty default leaves " ;"
  while IFS= read -r line; do
    if ! printf '%s\n' "$have" | grep -qxF -- "$line"; then
      echo "::error::$rel is missing or differs from ${headers#"$root"/} for: ${line%%|*}"
      st=1
    fi
  done <<< "$want"
  [ "$st" = 0 ] && echo "$rel matches ${headers#"$root"/} ($(printf '%s\n' "$want" | wc -l | tr -d ' ') headers)"
  return "$st"
}

status=0
if ! awk '/^[[:space:]]*header[[:space:]]*\{/ {on=1; next} on && /^[[:space:]]*\}/ {on=0} on {print}' "$caddy_api" \
  | grep -Eq '^[[:space:]]*Strict-Transport-Security[[:space:]]+"?max-age=0*[1-9][0-9]*'; then
  echo "::error::infra/caddy/Caddyfile.api no longer sets Strict-Transport-Security with a positive max-age in its header block"
  status=1
fi
compare "$root/apps/site/public/_headers" "$root/infra/caddy/Caddyfile.site" || status=1
compare "$root/apps/mobile/public/_headers" "$root/infra/caddy/Caddyfile.web" || status=1
[ "$status" = 0 ] && echo "Caddyfile.api sets HSTS"
exit "$status"
