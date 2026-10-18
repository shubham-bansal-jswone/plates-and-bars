#!/usr/bin/env bash
# The v1.1 backend switches (#944 barcode proxy, #946 AI image calls) are off in the compose file (#987, #985). Runs
# `docker compose config` only (no stack is started). Run from anywhere: infra/staging/test-compose-flags.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
cfg() { env -i PATH="$PATH" HOME="$HOME" "$@" docker compose -f "$here/docker-compose.yml" --env-file "$tmp/env" config; }
flags='OFF_ENABLED AI_MEAL_PHOTO_ENABLED AI_IMPORT_RECIPE_ENABLED AI_FORM_CHECK_ENABLED'
want() { grep -qx "      $2: $3" <<<"$1" || fail "$2 is not '$3'"; }

echo "defaults from .env.example: every switch off, no contact email"
cp "$here/.env.example" "$tmp/env"
out="$(cfg)"
for v in $flags; do want "$out" "$v" '"false"'; done
want "$out" OFF_CONTACT_EMAIL '""'
want "$out" OFF_BASE_URL https://world.openfoodfacts.org

echo "defaults with the variables missing from .env"
grep -v -E '^#?(OFF_|AI_)' "$here/.env.example" > "$tmp/env"
out="$(cfg)"
for v in $flags; do want "$out" "$v" '"false"'; done
want "$out" OFF_CONTACT_EMAIL '""'
want "$out" OFF_BASE_URL https://world.openfoodfacts.org

echo "a value in the environment reaches the API"
cp "$here/.env.example" "$tmp/env"
out="$(cfg OFF_ENABLED=true OFF_CONTACT_EMAIL=ops@example.org AI_FORM_CHECK_ENABLED=true)"
want "$out" OFF_ENABLED '"true"'
want "$out" OFF_CONTACT_EMAIL ops@example.org
want "$out" AI_FORM_CHECK_ENABLED '"true"'
want "$out" AI_MEAL_PHOTO_ENABLED '"false"'
want "$out" AI_IMPORT_RECIPE_ENABLED '"false"'

echo "no contact address is committed"
grep -qx 'OFF_CONTACT_EMAIL=' "$here/.env.example" || fail ".env.example has a contact email"
echo "ok"
