#!/usr/bin/env bash
# Tests check-site-url.sh: a release or production build fails without a site URL; other builds pass either way.
# Run from anywhere: infra/scripts/test-check-site-url.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { echo "FAIL: $*"; exit 1; }
if "$here/check-site-url.sh" true "" > /dev/null 2>&1; then fail "release build passed without a site URL"; fi
if "$here/check-site-url.sh" true > /dev/null 2>&1; then fail "release build passed with no argument"; fi
"$here/check-site-url.sh" true "https://site.example" > /dev/null 2>&1 || fail "release build with a URL failed"
"$here/check-site-url.sh" false "" > /dev/null 2>&1 || fail "a non-release build needs no URL"
"$here/check-site-url.sh" false "https://site.example" > /dev/null 2>&1 || fail "non-release with URL failed"
if "$here/check-site-url.sh" > /dev/null 2>&1; then fail "accepted no arguments"; fi
echo "check-site-url.sh tests passed"
