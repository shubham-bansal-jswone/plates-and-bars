#!/usr/bin/env bash
# Fails if a header in apps/site/public/_headers is missing from, or differs in, infra/caddy/Caddyfile.site.
# (Caddy ignores _headers; the site CSP and security headers are kept in both places.)
# Usage: infra/scripts/check-caddy-headers.sh   (from anywhere)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
headers="$root/apps/site/public/_headers"
caddy="$root/infra/caddy/Caddyfile.site"

# "  Name: value" in _headers -> "name|value"
want="$(sed -n 's/^[[:space:]][[:space:]]*\([A-Za-z-][A-Za-z-]*\):[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1|\2/p' "$headers" | awk -F'|' '{ n=tolower($1); sub(/^[^|]*\|/, ""); print n "|" $0 }')"
[ -n "$want" ] || { echo "::error::no headers parsed from $headers"; exit 1; }

# Caddyfile: lines inside the header { } block, "Name value" or Name "value" -> "name|value"
have="$(awk '/^[[:space:]]*header[[:space:]]*\{/ {on=1; next} on && /^[[:space:]]*\}/ {on=0} on {print}' "$caddy" \
  | sed -n 's/^[[:space:]]*\([A-Za-z-][A-Za-z-]*\)[[:space:]][[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1|\2/p' \
  | awk -F'|' '{ n=tolower($1); sub(/^[^|]*\|/, ""); v=$0; if (v ~ /^".*"$/) v=substr(v,2,length(v)-2); print n "|" v }')"

status=0
while IFS= read -r line; do
  if ! printf '%s\n' "$have" | grep -qxF -- "$line"; then
    echo "::error::infra/caddy/Caddyfile.site is missing or differs from apps/site/public/_headers for: ${line%%|*}"
    status=1
  fi
done <<< "$want"
[ "$status" = 0 ] && echo "Caddyfile.site matches _headers ($(printf '%s\n' "$want" | wc -l | tr -d ' ') headers)"
exit "$status"
