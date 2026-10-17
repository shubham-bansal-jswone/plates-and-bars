#!/usr/bin/env bash
# Tests check-sentry-origin.sh: accepts empty and a bare https origin (optional port), rejects http, a path, a trailing
# slash, a scheme-only or wildcard value, credentials, spaces and a second line; and requires an origin when a DSN is
# given. Run from anywhere: infra/scripts/test-check-sentry-origin.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { echo "FAIL: $*"; exit 1; }
"$here/check-sentry-origin.sh" "" > /dev/null 2>&1 || fail "rejected empty"
for ok in https://errors.example.com https://errors.example.com:8443 https://e https://a.b-c.d; do
  "$here/check-sentry-origin.sh" "$ok" > /dev/null 2>&1 || fail "rejected $ok"
done
# shellcheck disable=SC2016 # the literal text of an injection attempt
for bad in "https:" "*" "http://errors.example.com" "https://errors.example.com/" "https://errors.example.com/sentry" \
  "https://*" "https://errors.example.com; script-src *" "https://errors.example.com self" "https://-bad.com" \
  "https://user@errors.example.com" "https://errors.example.com:port" 'https://errors.example.com
https://evil.example.com'; do
  if "$here/check-sentry-origin.sh" "$bad" > /dev/null 2>&1; then fail "accepted '$bad'"; fi
done
# the pairing: a DSN with no origin is a silent drop, so it must fail
if "$here/check-sentry-origin.sh" "" "https://key@errors.example.com/1" > /dev/null 2>&1; then fail "accepted a DSN with no origin"; fi
"$here/check-sentry-origin.sh" "https://errors.example.com" "https://key@errors.example.com/1" > /dev/null 2>&1 \
  || fail "rejected a matched DSN and origin"
"$here/check-sentry-origin.sh" "https://errors.example.com" "" > /dev/null 2>&1 || fail "rejected an origin with no DSN"
echo "check-sentry-origin.sh tests passed"
