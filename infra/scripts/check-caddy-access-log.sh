#!/usr/bin/env bash
# Fails if the logs of infra/caddy (#714) are missing or lost a privacy filter, with the values pinned:
#  - Caddyfile.api and Caddyfile.web: a JSON access log to a rolling file (roll_size, roll_interval 24h, roll_keep 15,
#    roll_keep_for 336h = 14 days), client IPs masked (ipv4 24, ipv6 48) in remote_ip and client_ip, the query string
#    cut from the URI, request and response headers deleted.
#  - Caddyfile.api and Caddyfile.stack also rewrite everything after /foods/barcode/ to {code} (#944), so a scanned
#    barcode never reaches the logs. The rule is order independent (it also takes the query), which the tests prove.
#  - Caddyfile.stack: a global error log (include http.log.error http.handlers.reverse_proxy: the reverse_proxy WARN
#    carries the request) with the same IP mask, query cut, barcode rule and header delete.
#  - Caddyfile.stack, Caddyfile.site and glitchtip=<file> also carry a global `log default` block with the same filters
#    (checked inside the block): access lines for a Host missing from Caddy's per-host log map land in the default log.
#    Caddyfile.site (kind site) is only that block.
#  - glitchtip=<file> (Caddyfile.glitchtip, which has an access log and an error log in one file): both sets of checks
#    without the barcode rule (no such route there).
# Usage: infra/scripts/check-caddy-access-log.sh [api|web|stack|site|glitchtip=<file> ...]   (default: the four real files; from anywhere)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- "api=$root/infra/caddy/Caddyfile.api" "web=$root/infra/caddy/Caddyfile.web" "stack=$root/infra/caddy/Caddyfile.stack" "site=$root/infra/caddy/Caddyfile.site"
fi
status=0
for arg in "$@"; do
  kind="${arg%%=*}"; f="${arg#*=}"
  # active (non-comment) lines on one line, whitespace squeezed, so a block can be matched as a whole
  flat="$(grep -v '^[[:space:]]*#' "$f" | tr '\n\t' '  ' | tr -s ' ')"
  need() { # need <description> <extended regex>
    printf '%s\n' "$flat" | grep -Eq -- "$2" || { echo "::error::$f: $kind log lacks $1"; status=1; }
  }
  if [ "$kind" = stack ] || [ "$kind" = glitchtip ] || [ "$kind" = site ]; then
    # the global `log default` block, cut out by brace depth and checked on its own
    dflat="$(grep -v '^[[:space:]]*#' "$f" | awk '/^[[:space:]]*log default \{/ {on=1} on {print; n+=gsub(/\{/,"{"); m+=gsub(/\}/,"}"); if (n>0 && n==m) exit}' | tr '\n\t' '  ' | tr -s ' ')"
    dneed() { # dneed <description> <extended regex>, inside the log default block
      printf '%s\n' "$dflat" | grep -Eq -- "$2" || { echo "::error::$f: $kind log default lacks $1"; status=1; }
    }
    dneed "a log default block"        '^ ?log default \{ output stderr format filter \{ wrap json'
    for field in remote_ip client_ip; do
      dneed "request>$field ip_mask { ipv4 24 ipv6 48 }" "request>$field ip_mask \\{ ipv4 24 ipv6 48 \\}"
    done
    dneed "the query-string cut"       'request>uri regexp "\\\?\.\*\$" ""'
    dneed "request>headers delete"     'request>headers delete'
    dneed "resp_headers delete"        'resp_headers delete'
    if [ "$kind" = stack ]; then
      dneed "the barcode redaction"    'request>uri regexp "\(\?i\)\(/foods/barcode\)\(\?:/\|%2f\)\.\+\$" "\$\{1\}/\{code\}"'
    fi
  fi
  if [ "$kind" = site ]; then
    if printf '%s\n' "$flat" | grep -Eq 'log_credentials|level DEBUG'; then
      echo "::error::$f: log must not enable log_credentials"; status=1
    fi
    continue
  fi
  need "format filter wrapping json"  'format filter \{ wrap json'
  for field in remote_ip client_ip; do
    need "request>$field ip_mask { ipv4 24 ipv6 48 }" "request>$field ip_mask \\{ ipv4 24 ipv6 48 \\}"
  done
  need "the query-string cut"         'request>uri regexp "\\\?\.\*\$" ""'
  if [ "$kind" = api ] || [ "$kind" = stack ]; then
    need "the barcode redaction (/foods/barcode/... -> {code})" \
      'request>uri regexp "\(\?i\)\(/foods/barcode\)\(\?:/\|%2f\)\.\+\$" "\$\{1\}/\{code\}"'
  fi
  need "request>headers delete"       'request>headers delete'
  need "resp_headers delete"          'resp_headers delete'
  if [ "$kind" = stack ] || [ "$kind" = glitchtip ]; then
    need "include http.log.error http.handlers.reverse_proxy" 'include http\.log\.error http\.handlers\.reverse_proxy( |$)'
    need "output stderr"              'output stderr'
  fi
  if [ "$kind" != stack ]; then
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
