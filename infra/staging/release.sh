#!/usr/bin/env bash
# Production release, run ON the production VM by .github/workflows/production-deploy.yml after it has checked out the
# release tag (RUNBOOK.md section 4a): back up the database, then deploy that tag's API image with deploy.sh, which
# health-checks through the local Caddy and rolls API_TAG back to the previous image on failure. The backup runs
# first and a failed backup stops the release: nothing is deployed without a restorable copy.
# Usage: infra/staging/release.sh v1.2.3 <sha>
#   <sha> is the commit the workflow verified (on main) and checked out; HEAD and the tag must both be exactly that
#   commit, so a tag moved after approval is refused instead of deploying an unchecked commit.
# Exit status: 0 released and healthy; 1 refused, backup failed, or deploy failed (rolled back where possible).
set -euo pipefail
cd "$(dirname "$0")"
tag="${1:?usage: release.sh vMAJOR.MINOR.PATCH <sha>}"
sha="${2:?usage: release.sh vMAJOR.MINOR.PATCH <sha>}"
printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' || { echo "sha '$sha' must be a full 40-character commit id" >&2; exit 1; }
printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo "release tag '$tag' must be vMAJOR.MINOR.PATCH" >&2; exit 1; }
head_sha="$(git rev-parse HEAD)"
tag_sha="$(git rev-parse "refs/tags/$tag^{commit}")"
[ "$head_sha" = "$sha" ] || { echo "checkout is at $head_sha, not the verified commit $sha: check it out first" >&2; exit 1; }
[ "$tag_sha" = "$sha" ] || { echo "tag $tag now points at $tag_sha, not the verified commit $sha: the tag was moved, refusing" >&2; exit 1; }

echo "backing up before releasing $tag"
./backup.sh || { echo "backup failed: not deploying $tag" >&2; exit 1; }
DEPLOY_TAG="$tag" exec ./deploy.sh
