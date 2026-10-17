#!/usr/bin/env bash
# Runs detect-changes.sh against sample diffs in a throwaway repo and checks which jobs it enables.
# Usage: infra/scripts/test-detect-changes.sh
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/detect-changes.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
git init -q
git config user.email t@example.com
git config user.name t
mkdir -p tools/golden-gen packages/api/test-vectors packages/core apps/mobile/scripts apps/mobile/src/content apps/site backend/scripts tools content docs tests/e2e
for d in packages/api packages/core apps/mobile apps/site tools tests/e2e; do echo '{}' > "$d/package.json"; done
touch tools/golden-gen/cli.mjs backend/build.gradle apps/mobile/scripts/content-meta.mjs
git add -A && git commit -qm base

fail=0
# expect <file-changed> <jobs that must be true, space separated; all others must be false>
expect() {
  local file="$1" want=" $2 " j got
  mkdir -p "$(dirname "$file")"; echo "$RANDOM" >> "$file"
  git add -A && git commit -qm "change $file"
  : > out
  GITHUB_OUTPUT="$tmp/out" "$script" HEAD~1 > /dev/null
  for j in api core mobile backend tools golden site content_meta e2e e2e_sync; do
    got="$(sed -n "s/^run_$j=//p" out)"
    if [[ "$want" == *" $j "* ]]; then [ "$got" = true ] || { echo "FAIL: $file should run $j"; fail=1; }
    else [ "$got" = false ] || { echo "FAIL: $file should not run $j"; fail=1; }; fi
  done
  git reset -q --hard HEAD~1
}
expect content/cards.json "core mobile backend tools content_meta e2e e2e_sync"
expect content/new-file.json "core mobile backend tools content_meta e2e e2e_sync"
expect backend/scripts/x.sh "backend e2e_sync"
expect packages/api/test-vectors/sync-ids.json "api core mobile backend tools e2e e2e_sync"
expect packages/api/openapi.yaml "api core mobile backend e2e e2e_sync"
expect apps/site/src/a.txt "site"
expect apps/mobile/src/content/bundled.json "mobile content_meta e2e e2e_sync"
expect apps/mobile/scripts/content-meta.mjs "mobile content_meta e2e e2e_sync"
expect tests/e2e/stack/docker-compose.yml "e2e e2e_sync"
expect docs/spec/golden/foods.json "core tools golden"
expect docs/prototype/plate-and-bar.html "core tools golden"
expect tools/other/helper.mjs "tools"
expect tools/golden-gen/cases.mjs "tools golden"
expect docs/other.md ""
[ "$fail" = 0 ] && echo "detect-changes: all sample diffs OK"
exit "$fail"
