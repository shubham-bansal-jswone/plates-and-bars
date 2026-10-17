#!/usr/bin/env bash
# Tests android-release-config.sh against a copy of the real apps/mobile/app.json: a tag derives versionCode and version
# and needs a well-formed API URL; versionCode rises with every release; bad tags and missing variables fail on tags;
# non-tag runs use the run number. Run from anywhere: infra/scripts/test-android-release-config.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
url=https://api.example.com/api/v1

# run <ref_type> <ref_name> <run_number> <api_url>: fresh app.json, then the script; exit status is the script's
run() {
  cp "$root/apps/mobile/app.json" "$tmp/app.json"
  GITHUB_REF_TYPE="$1" GITHUB_REF_NAME="$2" GITHUB_RUN_NUMBER="$3" EXPO_PUBLIC_API_URL="$4" \
    "$here/android-release-config.sh" "$tmp/app.json" > "$tmp/out" 2>&1
}
field() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).expo; console.log(process.argv[2]==="version"?j.version:j.android.versionCode)' "$tmp/app.json" "$1"; }

run tag v1.2.3 7 "$url" || fail "valid tag failed: $(cat "$tmp/out")"
[ "$(field code)" = 1002003 ] || fail "v1.2.3 gave $(field code)"
[ "$(field version)" = 1.2.3 ] || fail "version not set from the tag"
grep -q '"package": "app.plateandbar.mobile"' "$tmp/app.json" || fail "other app.json fields were lost"

# rises with every release, whatever the run number
prev=0
for t in v0.1.0 v0.1.1 v0.2.0 v0.10.0 v1.0.0 v1.0.1 v1.9.9 v1.10.0 v2.0.0 v10.0.0; do
  run tag "$t" 1 "$url" || fail "$t failed: $(cat "$tmp/out")"
  c="$(field code)"; [ "$c" -gt "$prev" ] || fail "$t gave $c, not above $prev"; prev="$c"
done
run tag v2099.999.999 1 "$url" || fail "largest tag failed"; [ "$(field code)" -le 2100000000 ] || fail "above the Play limit"

# same tag, another run number: same code
run tag v1.2.3 99 "$url"; [ "$(field code)" = 1002003 ] || fail "code depends on the run number"

# tags that cannot be mapped
for bad in v1.2 v1.2.3-rc1 1.2.3 v01.2.3 v1.2.03 v1.1000.0 v1.0.1000 v2100.0.0 vx.y.z; do
  if run tag "$bad" 1 "$url"; then fail "accepted tag $bad"; fi
done

# API URL: required and well formed on a tag
if run tag v1.2.3 1 ""; then fail "tag build passed without EXPO_PUBLIC_API_URL"; fi
grep -q 'EXPO_PUBLIC_API_URL is not set' "$tmp/out" || fail "wrong error: $(cat "$tmp/out")"
for bad in http://api.example.com/api/v1 https://api.example.com https://api.example.com/api/v1/; do
  if run tag v1.2.3 1 "$bad"; then fail "tag build accepted $bad"; fi
done

# manual and PR builds: run number, URL optional (warning), a malformed URL still fails
run workflow_dispatch main 57 ""; [ "$(field code)" = 57 ] || fail "manual run number not used"
grep -q '::warning::EXPO_PUBLIC_API_URL is not set' "$tmp/out" || fail "no warning without the URL"
[ "$(field version)" = "$(node -e 'console.log(require(process.argv[1]).expo.version)' "$root/apps/mobile/app.json")" ] || fail "version changed on a non-tag run"
run pull_request 12/merge 3 "$url" || fail "PR run failed"
if run branch main 1 "http://x/api/v1"; then fail "non-tag run accepted a malformed URL"; fi
if run branch main "" ""; then fail "accepted an empty run number"; fi

echo "android-release-config.sh tests passed"
