#!/usr/bin/env bash
# Writes run_<name>=true|false to $GITHUB_OUTPUT for each CI job.
# A job runs when its folder has a build file AND (the event is not a PR, or
# the PR touched the folder or one of its upstream folders).
# Usage: detect-changes.sh <base-sha-or-empty>
set -euo pipefail
base="${1:-}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

if [ -n "$base" ]; then
  changed="$(git diff --name-only "$base"...HEAD)"
else
  changed="" # push to main / manual run: run everything that exists
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
if has_npm packages/core && want packages/core/ packages/api/; then emit core true; else emit core false; fi
# the app imports core and the generated client
if has_npm apps/mobile && want apps/mobile/ packages/core/ packages/api/; then emit mobile true; else emit mobile false; fi
if has_gradle backend && want backend/ packages/api/openapi.yaml; then emit backend true; else emit backend false; fi
