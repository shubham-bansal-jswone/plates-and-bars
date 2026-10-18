#!/usr/bin/env bash
# Writes run_<name>=true|false to $GITHUB_OUTPUT for each CI job.
# A job runs when its folder has a build file AND (the event is not a PR, or
# the PR touched the folder or one of its upstream folders).
# Usage: detect-changes.sh <base-rev-or-empty>
#   PR CI passes HEAD^1: HEAD is the tested merge commit and its first parent is
#   the current base tip, so the diff is exactly what the merge brings in (a
#   stale pull_request.base.sha would also list unrelated commits from main).
#   Empty (push to main, manual run), or a rev that does not resolve, runs
#   every job whose folder exists.
set -euo pipefail
base="${1:-}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

if [ -n "$base" ] && ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
  echo "::notice::base '$base' does not resolve; running every applicable job"
  base=""
fi
if [ -n "$base" ]; then
  changed="$(git diff --name-only "$base"...HEAD)"
else
  changed="" # run everything that exists
fi

touched() { # touched <prefix>...
  [ -z "$base" ] && return 0
  local p
  for p in "$@"; do
    if printf '%s\n' "$changed" | grep -q "^$p"; then return 0; fi
  done
  return 1
}
has_npm() { [ -f "$1/package.json" ]; }
has_gradle() { [ -f "$1/build.gradle" ] || [ -f "$1/build.gradle.kts" ]; }
emit() { echo "run_$1=$2" >> "$out"; }

# workflow/infra changes re-run everything
if touched .github/workflows/ci.yml infra/scripts/; then all=1; else all=0; fi
want() { [ "$all" = 1 ] && return 0; touched "$@"; }

if has_npm packages/api && want packages/api/; then emit api true; else emit api false; fi
if has_npm packages/core && want packages/core/ packages/api/ content/ docs/spec/golden/ docs/prototype/; then emit core true; else emit core false; fi
# the app imports core and the generated client
# the app also imports content/*.json and reads packages/api/test-vectors
if has_npm apps/mobile && want apps/mobile/ packages/core/ packages/api/ content/; then emit mobile true; else emit mobile false; fi
# the backend bundles every content/*.json and its tests read packages/api/test-vectors (backend/scripts is under backend/)
if has_gradle backend && want backend/ packages/api/openapi.yaml packages/api/test-vectors/ content/; then emit backend true; else emit backend false; fi
# check:sources (no IFCT/INDB) also scans the folders in tools/check-no-ifct/check.mjs SCAN_ROOTS: keep the two lists in step
if has_npm tools && want tools/ content/ docs/spec/golden/ docs/prototype/ packages/api/test-vectors/ apps/mobile/src/content/ apps/mobile/src/about/licences.json apps/site/src/ tests/e2e/store/ backend/src/main/resources/ backend/src/test/resources/; then emit tools true; else emit tools false; fi
# bundled.json in the app records the hash of each content file; needs only node
if [ -f apps/mobile/scripts/content-meta.mjs ] && want content/ apps/mobile/src/content/ apps/mobile/scripts/content-meta.mjs; then emit content_meta true; else emit content_meta false; fi
# the golden fixtures must equal what tools/golden-gen produces from the prototype (needs only node, no install)
if [ -f tools/golden-gen/cli.mjs ] && want docs/spec/golden/ docs/prototype/ tools/golden-gen/; then emit golden true; else emit golden false; fi
# the blog renders content/cards.json and checks it against the app's HIDDEN_CARDS list and the evidence note in WhyLink.tsx
if has_npm apps/site && want apps/site/ content/cards.json apps/mobile/src/why/cards.ts apps/mobile/src/why/WhyLink.tsx; then emit site true; else emit site false; fi
# the web end-to-end tests run the exported app; they need the app's inputs and their own folder
if has_npm tests/e2e && want tests/e2e/ apps/mobile/ packages/core/ packages/api/ content/; then emit e2e true; else emit e2e false; fi
# the sync tests also run the real API (tests/e2e/stack builds backend/), so a backend change must run them
if has_npm tests/e2e && want tests/e2e/ apps/mobile/ packages/core/ packages/api/ content/ backend/; then emit e2e_sync true; else emit e2e_sync false; fi
# the Play listing text must stay within Google's limits and carry the setup disclaimer word for word (needs only node, no install)
if [ -f docs/check-play-listing.mjs ] && want docs/PLAY-STORE-LISTING.md docs/check-play-listing.mjs apps/mobile/src/setup/copy.ts; then emit play_listing true; else emit play_listing false; fi
