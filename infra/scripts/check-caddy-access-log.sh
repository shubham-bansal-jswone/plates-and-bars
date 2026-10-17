#!/usr/bin/env bash
# Fails if the access log of infra/caddy/Caddyfile.api or Caddyfile.web (#714) is missing, or lost a privacy filter:
# JSON output to a rolling file with a retention (roll_keep_for), the IP masked in remote_ip, client_ip and remote_addr,
# the query string cut from the URI, and request and response headers (Authorization, Cookie ...) deleted.
# Usage: infra/scripts/check-caddy-access-log.sh [Caddyfile ...]   (default: both files; from anywhere)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
[ "$#" -gt 0 ] || set -- "$root/infra/caddy/Caddyfile.api" "$root/infra/caddy/Caddyfile.web"
status=0
for f in "$@"; do
  # active (non-comment) lines only
  body="$(grep -v '^[[:space:]]*#' "$f" || true)"
  need() { # need <description> <extended regex>
    printf '%s\n' "$body" | grep -Eq "$2" || { echo "::error::$f: access log lacks $1"; status=1; }
  }
  need "a log block"                   '^[[:space:]]*log[[:space:]]+[a-z_]+[[:space:]]*\{'
  need "a rolling file output"         '^[[:space:]]*output file /'
  need "roll_size"                     '^[[:space:]]*roll_size[[:space:]]+[0-9]'
  need "a retention (roll_keep_for)"   '^[[:space:]]*roll_keep_for[[:space:]]+[0-9]+h'
  need "format filter wrapping json"   '^[[:space:]]*wrap json'
  for field in remote_ip client_ip remote_addr; do
    need "an ip_mask on request>$field" "^[[:space:]]*request>$field ip_mask"
  done
  need "the query-string cut"          '^[[:space:]]*request>uri regexp "\\\?\.\*\$" ""'
  need "request>headers delete"        '^[[:space:]]*request>headers delete'
  need "resp_headers delete"           '^[[:space:]]*resp_headers delete'
  if printf '%s\n' "$body" | grep -Eq 'log_credentials|^[[:space:]]*level[[:space:]]+DEBUG'; then
    echo "::error::$f: access log must not enable log_credentials"; status=1
  fi
done
[ "$status" = 0 ] && echo "access log filters present in $# Caddyfile(s)"
exit "$status"
