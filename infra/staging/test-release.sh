#!/usr/bin/env bash
# Runs release.sh with a stub git and stub backup.sh / deploy.sh: the backup runs before the deploy and the deploy gets
# DEPLOY_TAG=<tag>; a failed backup stops the release before anything is deployed; a checkout that is not the tag's commit,
# or a tag that is not vMAJOR.MINOR.PATCH, is refused before the backup; a failed deploy (which rolls back inside
# deploy.sh, see test-deploy.sh) makes the release fail. No Docker, network or VM needed. Run from anywhere: infra/staging/test-release.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/s"
cp "$here/release.sh" "$tmp/s/"
cat > "$tmp/s/backup.sh" <<'STUB'
#!/usr/bin/env bash
echo "backup" >> "$STUB_LOG"
[ -z "${STUB_BACKUP_FAIL:-}" ]
STUB
cat > "$tmp/s/deploy.sh" <<'STUB'
#!/usr/bin/env bash
echo "deploy DEPLOY_TAG=${DEPLOY_TAG:-}" >> "$STUB_LOG"
[ -z "${STUB_DEPLOY_FAIL:-}" ]
STUB
# HEAD is $STUB_HEAD; a tag resolves to $STUB_TAG_SHA
cat > "$tmp/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "rev-parse HEAD") echo "$STUB_HEAD" ;;
  rev-parse\ refs/tags/*) echo "$STUB_TAG_SHA" ;;
  *) echo "unexpected git $*" >&2; exit 2 ;;
esac
STUB
chmod +x "$tmp/s/"*.sh "$tmp/bin/git"
export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" STUB_HEAD=aaa STUB_TAG_SHA=aaa
fail() { echo "FAIL: $*"; cat "$STUB_LOG"; exit 1; }
rel() { : > "$STUB_LOG"; "$tmp/s/release.sh" "$@" > "$tmp/out" 2>&1; }

rel v1.2.3 || fail "release failed: $(cat "$tmp/out")"
[ "$(cat "$STUB_LOG")" = "$(printf 'backup\ndeploy DEPLOY_TAG=v1.2.3')" ] || fail "expected backup then deploy with the tag"

if STUB_BACKUP_FAIL=1 rel v1.2.3; then fail "release passed with a failed backup"; fi
! grep -q deploy "$STUB_LOG" || fail "deployed after a failed backup"
grep -q 'backup failed: not deploying v1.2.3' "$tmp/out" || fail "wrong error: $(cat "$tmp/out")"

if STUB_DEPLOY_FAIL=1 rel v1.2.3; then fail "release passed with a failed deploy"; fi
grep -q '^backup$' "$STUB_LOG" || fail "no backup before the failed deploy"

if STUB_HEAD=bbb rel v1.2.3; then fail "released a checkout that is not the tag"; fi
[ ! -s "$STUB_LOG" ] || fail "backup or deploy ran for the wrong commit"

for bad in 1.2.3 v1.2 v1.2.3-rc1 main 'v1.2.3;x' v1.2.3/x; do
  if rel "$bad"; then fail "accepted tag '$bad'"; fi
  [ ! -s "$STUB_LOG" ] || fail "backup or deploy ran for tag '$bad'"
done
if rel; then fail "accepted no tag"; fi

echo "release.sh tests passed"
