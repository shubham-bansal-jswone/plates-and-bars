#!/usr/bin/env bash
# Fails when $1 is "true" (a release or production build) and $2 (EXPO_PUBLIC_SITE_URL) is empty: the app hides its
# privacy, terms and deletion links without it and Google Play needs the privacy link (#825, #827). Other builds pass.
# Usage: infra/scripts/check-site-url.sh <true|false> "$EXPO_PUBLIC_SITE_URL"
set -euo pipefail
required="${1:?usage: check-site-url.sh <true|false> <url>}"
url="${2:-}"
if [ "$required" = true ] && [ -z "$url" ]; then
  echo "::error::EXPO_PUBLIC_SITE_URL is not set: release and production builds need it (the app's privacy link; set the environment variable to the https origin of the website)"
  exit 1
fi
echo "site URL ok"
