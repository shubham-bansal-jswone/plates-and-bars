#!/usr/bin/env bash
# Fails unless $1 is a safe WEB_ROOT for `rsync --delete`: a plain absolute path (letters, digits, _ . / -), no "." or
# ".." segment, and a directory under /srv, /var/www or /opt (never / or a home directory). Used by web-deploy.yml.
# Usage: infra/scripts/check-web-root.sh "$WEB_ROOT"
set -euo pipefail
root="${1:-}"
[ -n "$root" ] || { echo "::error::WEB_ROOT is not set"; exit 1; }
# grep works per line: a value with a newline would pass on its first line, so refuse it outright
case "$root" in *$'\n'*) echo "::error::WEB_ROOT must be a single line"; exit 1 ;; esac
if ! printf '%s' "$root" | grep -Eq '^/[A-Za-z0-9_./-]+$' || printf '%s' "$root" | grep -Eq '(^|/)\.\.?(/|$)'; then
  echo "::error::WEB_ROOT must be a plain absolute path without '.' or '..' segments, for example /opt/plateandbar/infra/staging/web"
  exit 1
fi
if ! printf '%s' "$root" | grep -Eq '^/(srv|opt|var/www)/[^/]+'; then
  echo "::error::WEB_ROOT must be a directory under /srv, /var/www or /opt, for example /opt/plateandbar/infra/staging/web"
  exit 1
fi
