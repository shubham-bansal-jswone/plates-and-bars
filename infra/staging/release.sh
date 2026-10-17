#!/usr/bin/env bash
# Production release, run ON the production VM by .github/workflows/production-deploy.yml after it has checked out the
# release tag (RUNBOOK.md section 4a): back up the database, then deploy that tag's API image with deploy.sh, which
# health-checks through the local Caddy and rolls API_TAG back to the previous image on failure. The backup runs
# first and a failed backup stops the release: nothing is deployed without a restorable copy.
# Usage: infra/staging/release.sh v1.2.3   (HEAD must be the commit the tag points at)
# Exit status: 0 released and healthy; 1 refused, backup failed, or deploy failed (rolled back where possible).
set -euo pipefail
cd "$(dirname "$0")"
tag="${1:?usage: release.sh vMAJOR.MINOR.PATCH}"
printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo "release tag '$tag' must be vMAJOR.MINOR.PATCH" >&2; exit 1; }
head_sha="$(git rev-parse HEAD)"
tag_sha="$(git rev-parse "refs/tags/$tag^{commit}")"
[ "$head_sha" = "$tag_sha" ] || { echo "checkout is at $head_sha, tag $tag is $tag_sha: check out the tag first" >&2; exit 1; }

echo "backing up before releasing $tag"
./backup.sh || { echo "backup failed: not deploying $tag" >&2; exit 1; }
DEPLOY_TAG="$tag" exec ./deploy.sh
