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
if has_npm apps/mobile && want apps/mobile/ packages/core/ packages/api/; then emit mobile true; else emit mobile false; fi
if has_gradle backend && want backend/ packages/api/openapi.yaml; then emit backend true; else emit backend false; fi
if has_npm tools && want tools/ content/ docs/spec/golden/ docs/prototype/; then emit tools true; else emit tools false; fi
if has_npm apps/site && want apps/site/; then emit site true; else emit site false; fi
