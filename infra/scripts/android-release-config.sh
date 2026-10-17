#!/usr/bin/env bash
# Prepares apps/mobile/app.json for an Android release build in CI, before `expo prebuild` (#684). Nothing is committed:
# the edit lives in the runner's checkout only.
#   - EXPO_PUBLIC_API_URL (the repository variable) is required on a v* tag and must be https://<host>/api/v1: a release
#     build without it has sync, sign-in, AI and content refresh switched off (apps/mobile/src/sync/auth.ts).
#   - android.versionCode: on a tag vX.Y.Z it is X*1000000 + Y*1000 + Z (v1.2.3 -> 1002003), so it rises with every
#     release and the same tag always gives the same code (a re-run is reproducible). `version` is set to X.Y.Z. A tag
#     that is not plain vX.Y.Z, or has a part of 1000 or more (X: 2100 or more), fails. Other runs (manual, PR) use the
#     workflow run number, which is not meant for Google Play.
# Usage: android-release-config.sh <app.json>   Environment: GITHUB_REF_TYPE, GITHUB_REF_NAME, GITHUB_RUN_NUMBER,
#        EXPO_PUBLIC_API_URL. Appends the versionCode to $GITHUB_STEP_SUMMARY when set.
set -euo pipefail
app_json="${1:?usage: android-release-config.sh <app.json>}"
ref_type="${GITHUB_REF_TYPE:-}"
ref_name="${GITHUB_REF_NAME:-}"
run_number="${GITHUB_RUN_NUMBER:-}"
api_url="${EXPO_PUBLIC_API_URL:-}"
is_tag=false
[ "$ref_type" = tag ] && is_tag=true

if [ "$is_tag" = true ] && [ -z "$api_url" ]; then
  echo "::error::EXPO_PUBLIC_API_URL is not set. Add the repository variable (Settings > Secrets and variables > Actions > Variables), for example https://api.example.com/api/v1; a release build without it has sync switched off."
  exit 1
fi
if [ -n "$api_url" ] && ! printf '%s' "$api_url" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/api/v1$'; then
  echo "::error::EXPO_PUBLIC_API_URL must be https://<host>/api/v1 with no trailing slash"
  exit 1
fi
if [ -z "$api_url" ]; then
  echo "::warning::EXPO_PUBLIC_API_URL is not set: this build has sync, sign-in, AI and content refresh switched off (fine for a test build)"
fi

version=""
if [ "$is_tag" = true ]; then
  if ! printf '%s' "$ref_name" | grep -Eq '^v(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$'; then
    echo "::error::tag '$ref_name' must be vMAJOR.MINOR.PATCH (MINOR and PATCH below 1000, MAJOR below 2100) to derive android.versionCode"
    exit 1
  fi
  IFS=. read -r major minor patch <<< "${ref_name#v}"
  [ "$major" -lt 2100 ] || { echo "::error::major version $major is too large for android.versionCode"; exit 1; }
  code=$((major * 1000000 + minor * 1000 + patch))
  version="${ref_name#v}"
else
  printf '%s' "$run_number" | grep -Eq '^[1-9][0-9]{0,8}$' || { echo "::error::GITHUB_RUN_NUMBER is missing or not a positive number"; exit 1; }
  code="$run_number"
fi

APP_JSON="$app_json" VERSION_CODE="$code" VERSION="$version" node -e '
const fs = require("fs");
const file = process.env.APP_JSON;
const json = JSON.parse(fs.readFileSync(file, "utf8"));
if (!json.expo || !json.expo.android) { console.error("::error::" + file + " has no expo.android"); process.exit(1); }
json.expo.android.versionCode = Number(process.env.VERSION_CODE);
if (process.env.VERSION) json.expo.version = process.env.VERSION;
fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
'
echo "android.versionCode=$code${version:+, version=$version}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "android.versionCode $code${version:+ (version $version)}; API URL ${api_url:-not set}" >> "$GITHUB_STEP_SUMMARY"
fi
