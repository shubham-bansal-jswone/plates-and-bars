#!/usr/bin/env bash
# Tests check-api-url.sh: accepts the expected shape, rejects empty, http, a missing or wrong path, a trailing slash,
# credentials and spaces. Run from anywhere: infra/scripts/test-check-api-url.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { echo "FAIL: $*"; exit 1; }
for ok in https://api.example.com/api/v1 https://api.example.com:8443/api/v1 https://a/api/v1; do
  "$here/check-api-url.sh" "$ok" > /dev/null 2>&1 || fail "rejected $ok"
done
for bad in "" http://api.example.com/api/v1 https://api.example.com https://api.example.com/ https://api.example.com/api/v1/ \
  https://api.example.com/api https://user@api.example.com/api/v1 "https://api.example.com/api/v1 x" https://-bad.com/api/v1; do
  if "$here/check-api-url.sh" "$bad" > /dev/null 2>&1; then fail "accepted '$bad'"; fi
done
if "$here/check-api-url.sh" > /dev/null 2>&1; then fail "accepted no argument"; fi
echo "check-api-url.sh tests passed"
