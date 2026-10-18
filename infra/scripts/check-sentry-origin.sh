#!/usr/bin/env bash
# Fails unless $1 (WEB_SENTRY_ORIGIN) is empty or a bare origin for the web CSP connect-src: https, a host (optional
# port), no path, no trailing slash, no wildcard, for example https://errors.example.com. The value is interpolated
# into the Content-Security-Policy header (infra/caddy/Caddyfile.web) unquoted, so a scheme-only or wildcard value
# ("https:", "*") would open connect-src to any host, and a stray ";" would inject another directive. When $2 (the web
# build's EXPO_PUBLIC_SENTRY_DSN) is set, $1 must be set too and must equal the DSN's scheme://host[:port] (the key@
# and the path are dropped; host case is ignored): otherwise the CSP would block the reports and they would be dropped
# silently. (Caddy reads its own copy of the origin from the VM .env; that copy is not checked here.) Run it against the staging .env after editing (infra/RUNBOOK.md section 7).
# Usage: infra/scripts/check-sentry-origin.sh "$WEB_SENTRY_ORIGIN" ["$EXPO_PUBLIC_SENTRY_DSN"]
set -euo pipefail
origin="${1:-}"
dsn="${2:-}"
if [ -n "$origin" ]; then
  # grep works per line: a value with a newline would pass on its first line, so refuse it outright
  case "$origin" in *$'\n'*) echo "::error::WEB_SENTRY_ORIGIN must be a single line"; exit 1 ;; esac
  if ! printf '%s' "$origin" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'; then
    echo "::error::WEB_SENTRY_ORIGIN must be https://<host>[:port] with no path, trailing slash or wildcard, for example https://errors.example.com"
    exit 1
  fi
fi
if [ -n "$dsn" ] && [ -z "$origin" ]; then
  echo "::error::EXPO_PUBLIC_SENTRY_DSN is set but WEB_SENTRY_ORIGIN is empty: the CSP would drop error reports; set WEB_SENTRY_ORIGIN to the origin of that DSN"
  exit 1
fi
if [ -n "$dsn" ]; then
  case "$dsn" in *$'\n'*) echo "::error::EXPO_PUBLIC_SENTRY_DSN must be a single line"; exit 1 ;; esac
  dsn_origin="$(printf '%s' "$dsn" | sed -nE 's#^(https?://)([^@/?\#]*@)?([^/?\#]+).*#\1\3#p' | tr '[:upper:]' '[:lower:]')"
  if [ -z "$dsn_origin" ]; then
    echo "::error::EXPO_PUBLIC_SENTRY_DSN is not an http(s) URL"
    exit 1
  fi
  if [ "$dsn_origin" != "$(printf '%s' "$origin" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "::error::WEB_SENTRY_ORIGIN ($origin) is not the origin of EXPO_PUBLIC_SENTRY_DSN ($dsn_origin): the CSP would drop every error report"
    exit 1
  fi
fi
echo "error-tracking origin ok"
