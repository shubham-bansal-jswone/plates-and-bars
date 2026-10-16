#!/usr/bin/env bash
# Runs deploy.sh against stub docker, git, curl and sleep: a healthy deploy moves API_TAG to the new sha; an unhealthy
# one, or a failed `compose up`, rolls API_TAG back to the previous tag and exits non-zero; with no previous image or
# no API_TAG in .env it exits non-zero and does not roll back; a failed build leaves API_TAG alone. No Docker, network or VM needed. Run from anywhere: infra/staging/test-deploy.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/infra/staging" "$tmp/backend/scripts"
cp "$here/deploy.sh" "$tmp/infra/staging/"
stack="$tmp/infra/staging"
printf '#!/bin/sh\necho "x=2026-01-01T00:00:00Z"\n' > "$tmp/backend/scripts/content-updated-at.sh"
chmod +x "$tmp/backend/scripts/content-updated-at.sh"
cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $* [API_TAG=${API_TAG:-}]" >> "$STUB_LOG"
if [ "$1" = image ] && [ -n "${STUB_NO_PREV_IMAGE:-}" ]; then exit 1; fi
if [ "$*" = "compose build api" ] && [ -n "${STUB_BUILD_FAIL:-}" ]; then exit 1; fi
# STUB_UP_FAIL: only `compose up -d` without a service fails (the rollback's `up -d api` works)
if [ "$*" = "compose up -d" ] && [ -n "${STUB_UP_FAIL:-}" ]; then exit 1; fi
STUB
cat > "$tmp/bin/git" <<'STUB'
#!/usr/bin/env bash
echo abc123def456
STUB
# healthy while STUB_HEALTHY is a tag list containing the tag in .env
cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
# STUB_CURL_FAILS=N: the first N calls fail whatever the tag, to exercise the retry loop
if [ -n "${STUB_CURL_FAILS:-}" ]; then
  n="$(cat "$STUB_COUNT" 2>/dev/null || echo 0)"; echo $((n + 1)) > "$STUB_COUNT"
  [ "$n" -ge "$STUB_CURL_FAILS" ] || exit 22
fi
tag="$(sed -n 's/^API_TAG=//p' "$STUB_ENV")"
case ",$STUB_HEALTHY," in *",$tag,"*) exit 0 ;; esac
exit 22
STUB
printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/sleep"
chmod +x "$tmp/bin/"*

fail() { echo "FAIL: $*"; cat "$STUB_LOG"; exit 1; }
export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_ENV="$stack/.env" STUB_COUNT="$tmp/count" HEALTH_TIMEOUT_SECONDS=0
tag_now() { sed -n 's/^API_TAG=//p' "$stack/.env"; }
reset() { printf 'API_HOST=api.test\nAPI_TAG=oldtag\nDB_PASSWORD=x\n' > "$stack/.env"; : > "$STUB_LOG"; }

reset
STUB_HEALTHY=abc123def456 "$stack/deploy.sh" > /dev/null 2>&1 || fail "healthy deploy exited non-zero"
[ "$(tag_now)" = abc123def456 ] || fail "API_TAG not moved to the new sha"
grep -q 'docker compose build api \[API_TAG=abc123def456\]' "$STUB_LOG" || fail "image not built with the sha tag"
grep -q 'curl .*--resolve api.test:443:127.0.0.1 .*https://api.test/api/v1/health$' "$STUB_LOG" || fail "health URL not polled"
grep -q '^DB_PASSWORD=x$' "$stack/.env" || fail "other .env lines were changed"

reset
if STUB_HEALTHY=oldtag "$stack/deploy.sh" > /dev/null 2>&1; then fail "unhealthy deploy exited 0"; fi
[ "$(tag_now)" = oldtag ] || fail "API_TAG not rolled back"
grep -q 'docker compose up -d api' "$STUB_LOG" || fail "api not recreated on rollback"

reset
if STUB_UP_FAIL=1 STUB_HEALTHY=abc123def456,oldtag "$stack/deploy.sh" > /dev/null 2>&1; then fail "failed compose up exited 0"; fi
[ "$(tag_now)" = oldtag ] || fail "failed compose up: API_TAG not restored"
grep -q 'docker compose up -d api' "$STUB_LOG" || fail "failed compose up: api not recreated on rollback"

# the health check retries: two failures, then healthy, with a timeout that never expires in the test
reset; rm -f "$STUB_COUNT"
HEALTH_TIMEOUT_SECONDS=600 STUB_CURL_FAILS=2 STUB_HEALTHY=abc123def456 "$stack/deploy.sh" > /dev/null 2>&1 || fail "health retry: deploy failed"
[ "$(tag_now)" = abc123def456 ] || fail "health retry: tag not kept"
[ "$(grep -c '^curl ' "$STUB_LOG")" = 3 ] || fail "health retry: expected 3 curl calls"

reset
if STUB_HEALTHY=none STUB_NO_PREV_IMAGE=1 "$stack/deploy.sh" > /dev/null 2>&1; then fail "deploy without previous image exited 0"; fi
! grep -q 'docker compose up -d api' "$STUB_LOG" || fail "rolled back to an image that does not exist"

# no API_TAG in .env: nothing to roll back to, even though an image with an empty tag "exists" for the stub
reset
printf 'API_HOST=api.test\nDB_PASSWORD=x\n' > "$stack/.env"
if STUB_HEALTHY=none "$stack/deploy.sh" > /dev/null 2>&1; then fail "deploy with no API_TAG in .env exited 0 while unhealthy"; fi
! grep -q 'docker compose up -d api' "$STUB_LOG" || fail "rolled back although .env had no API_TAG"

# a failed build stops the deploy before API_TAG is touched and before anything is started
reset
if STUB_BUILD_FAIL=1 STUB_HEALTHY=abc123def456,oldtag "$stack/deploy.sh" > /dev/null 2>&1; then fail "failed build exited 0"; fi
[ "$(tag_now)" = oldtag ] || fail "failed build changed API_TAG"
! grep -q 'docker compose up' "$STUB_LOG" || fail "compose up ran after a failed build"

echo "deploy.sh tests passed"
