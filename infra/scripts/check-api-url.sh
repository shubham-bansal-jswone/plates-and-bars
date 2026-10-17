#!/usr/bin/env bash
# Fails unless $1 looks like the app's API base URL: https, a host (optional port) and the /api/v1 version path with no
# trailing slash, for example https://api.example.com/api/v1 (createClient in packages/api takes the version path
# included). Used by web-deploy.yml before EXPO_PUBLIC_API_URL is baked into the bundle.
# Usage: infra/scripts/check-api-url.sh "$EXPO_PUBLIC_API_URL"
set -euo pipefail
url="${1:-}"
[ -n "$url" ] || { echo "::error::EXPO_PUBLIC_API_URL is not set (for example https://api.example.com/api/v1)"; exit 1; }
if ! printf '%s' "$url" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/api/v1$'; then
  echo "::error::EXPO_PUBLIC_API_URL must be https://<host>/api/v1 with no trailing slash"
  exit 1
fi
echo "API URL ok"
