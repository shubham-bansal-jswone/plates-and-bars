#!/usr/bin/env bash
# Fails if the logs of infra/caddy (#714) are missing or lost a privacy filter, with the values pinned:
#  - Caddyfile.api and Caddyfile.web: a JSON access log to a rolling file (roll_size, roll_interval 24h, roll_keep 15,
#    roll_keep_for 336h = 14 days), client IPs masked (ipv4 24, ipv6 48) in remote_ip and client_ip, the query string
#    cut from the URI, request and response headers deleted.
#  - Caddyfile.stack: a global error log (include http.log.error) with the same IP mask, query cut and header delete.
# Usage: infra/scripts/check-caddy-access-log.sh [api|web|stack=<file> ...]   (default: the three real files; from anywhere)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- "api=$root/infra/caddy/Caddyfile.api" "web=$root/infra/caddy/Caddyfile.web" "stack=$root/infra/caddy/Caddyfile.stack"
fi
status=0
for arg in "$@"; do
  kind="${arg%%=*}"; f="${arg#*=}"
  # active (non-comment) lines on one line, whitespace squeezed, so a block can be matched as a whole
  flat="$(grep -v '^[[:space:]]*#' "$f" | tr '\n\t' '  ' | tr -s ' ')"
  need() { # need <description> <extended regex>
    printf '%s\n' "$flat" | grep -Eq -- "$2" || { echo "::error::$f: $kind log lacks $1"; status=1; }
  }
  need "format filter wrapping json"  'format filter \{ wrap json'
  for field in remote_ip client_ip; do
    need "request>$field ip_mask { ipv4 24 ipv6 48 }" "request>$field ip_mask \\{ ipv4 24 ipv6 48 \\}"
  done
  need "the query-string cut"         'request>uri regexp "\\\?\.\*\$" ""'
  need "request>headers delete"       'request>headers delete'
  need "resp_headers delete"          'resp_headers delete'
  if [ "$kind" = stack ]; then
    need "include http.log.error"     'include http\.log\.error'
    need "output stderr"              'output stderr'
  else
    need "a rolling file output"      'output file /[a-z_./-]+ \{'
    need "roll_size 10MiB"            'roll_size 10MiB'
    need "roll_interval 24h"          'roll_interval 24h'
    need "roll_keep 15"               'roll_keep 15( |$)'
    need "roll_keep_for 336h"         'roll_keep_for 336h( |$)'
  fi
  if printf '%s\n' "$flat" | grep -Eq 'log_credentials|level DEBUG'; then
    echo "::error::$f: log must not enable log_credentials"; status=1
  fi
done
[ "$status" = 0 ] && echo "log filters present in $# Caddyfile(s)"
exit "$status"
