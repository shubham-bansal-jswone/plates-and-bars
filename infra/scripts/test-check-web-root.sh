#!/usr/bin/env bash
# Tests check-web-root.sh. Run from anywhere: infra/scripts/test-check-web-root.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { echo "FAIL: $*"; exit 1; }
for ok in /opt/plateandbar/infra/staging/web /srv/web /var/www/app /opt/a.b/web-1_x /opt/.hidden/web /opt/web.; do
  "$here/check-web-root.sh" "$ok" > /dev/null 2>&1 || fail "rejected $ok"
done
# shellcheck disable=SC2016 # the literal text of an injection attempt
for bad in "" / /opt /opt/ /root/web /home/u/web /srv /opt/. /opt/./web /opt/web/. /opt/.. /opt/../etc /opt/a/../b /./opt/x \
  '/opt/x;id' '/opt/x$(id)' '/opt/x y' "/opt/x'y" '/opt/x"y' 'opt/x' '/opt/x
y'; do
  if "$here/check-web-root.sh" "$bad" > /dev/null 2>&1; then fail "accepted '$bad'"; fi
done
if "$here/check-web-root.sh" > /dev/null 2>&1; then fail "accepted no argument"; fi
echo "check-web-root.sh tests passed"
