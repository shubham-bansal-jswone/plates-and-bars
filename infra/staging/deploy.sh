#!/usr/bin/env bash
# Deploys the checked-out commit to staging, run ON the VM by .github/workflows/staging-deploy.yml after it has
# fast-forwarded the checkout (RUNBOOK.md section 2): build the API image tagged with the short commit sha, point
# API_TAG in .env at it, `docker compose up -d`, poll /api/v1/health, and on failure restore the previous tag.
# DEPLOY_TAG (optional): image tag to use instead of the short commit sha, e.g. the release tag v1.2.3 (release.sh
# sets it for production). Letters, digits, '.', '_' and '-' only.
# Exit status: 0 deployed and healthy; 1 failed (rolled back, or nothing to roll back to).
set -euo pipefail
cd "$(dirname "$0")"
timeout="${HEALTH_TIMEOUT_SECONDS:-300}"

# .env is read with sed, not sourced: an exported API_TAG would override the line this script rewrites
env_get() { sed -n "s/^$1=//p" .env | tail -n 1; }
# API_RELEASE is the tag without a leading v (plateandbar-api@1.2.3, lining up with the app's plate-and-bar@1.2.3); compose
# cannot strip the v, so it is written next to API_TAG
set_tag() { # rewrite in place (no sed -i: differs between GNU and BSD) and keep .env's mode
  sed -e "s/^API_TAG=.*/API_TAG=$1/" -e "s/^API_RELEASE=.*/API_RELEASE=${1#v}/" .env > .env.new
  grep -q '^API_RELEASE=' .env.new || printf 'API_RELEASE=%s\n' "${1#v}" >> .env.new
  cat .env.new > .env
  rm -f .env.new
}
healthy() {
  local deadline=$((SECONDS + timeout))
  # through the local Caddy, so a VM that cannot reach its own public address (hairpin NAT) still deploys
  until curl -fsS -m 5 --resolve "$api_host:443:127.0.0.1" -o /dev/null "https://$api_host/api/v1/health"; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 5
  done
}

api_host="$(env_get API_HOST)"
prev="$(env_get API_TAG)"
[ -n "$api_host" ] || { echo "API_HOST is not set in .env" >&2; exit 1; }
tag="${DEPLOY_TAG:-$(git rev-parse --short=12 HEAD)}"
printf '%s' "$tag" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' || { echo "invalid image tag '$tag'" >&2; exit 1; }

echo "deploying $tag (previous: ${prev:-none})"
CONTENT_UPDATED_AT="$(../../backend/scripts/content-updated-at.sh)" API_TAG="$tag" docker compose build api
set_tag "$tag" # only after a successful build
if docker compose up -d && healthy; then
  echo "healthy: $tag"
  exit 0
fi

echo "compose up or the health check failed (health timeout ${timeout}s)" >&2
docker compose logs --tail 50 api >&2 || true
if [ -z "$prev" ] || [ "$prev" = "$tag" ] || ! docker image inspect "plateandbar-api:$prev" > /dev/null 2>&1; then
  echo "no previous image to roll back to (API_TAG was '${prev:-}')" >&2
  exit 1
fi
# An image built before #887 reads ERASURE_LEDGER_PATH, which this compose file no longer sets: it cannot start, so
# going back below #887 is a manual step (RUNBOOK.md section 3a). Images built from #887 on carry this label.
if [ "$(docker image inspect -f '{{ index .Config.Labels "app.plateandbar.erasure-ledger-dir" }}' "plateandbar-api:$prev" 2> /dev/null)" != 1 ]; then
  echo "previous image $prev predates the per-day erasure ledger (#887) and cannot start with this compose file: no automatic rollback, see RUNBOOK.md section 3a" >&2
  exit 1
fi
echo "rolling back to $prev" >&2
set_tag "$prev"
docker compose up -d api
healthy || echo "previous tag $prev is also unhealthy: check the VM" >&2
exit 1
