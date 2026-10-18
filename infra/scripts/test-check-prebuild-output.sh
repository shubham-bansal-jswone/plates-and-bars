#!/usr/bin/env bash
# Runs check-prebuild-output.sh against sample trees in a throwaway repo: passes on a clean tree
# (including one whose package.json is formatted differently), fails on tracked prebuild output
# under apps/mobile/android or apps/mobile/ios, on the scripts "expo prebuild" writes into
# apps/mobile/package.json, and when the .gitignore rules go missing or lose their leading slash. It also checks the failure
# names the offending path, so a check that fails for the wrong reason is caught.
# Usage: infra/scripts/test-check-prebuild-output.sh
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/check-prebuild-output.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0

pkg_body='{
  "name": "@plate-and-bar/mobile",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "web": "expo start --web"
  },
  "expo": { "install": { "exclude": ["jest"] } }
}'

fresh() { # a repo shaped like the real one, one commit deep
  rm -rf "$tmp/repo"
  mkdir -p "$tmp/repo/apps/mobile/src"
  cd "$tmp/repo"
  git init -q
  git config user.email t@example.com
  git config user.name t
  printf 'node_modules/\n/android/\n/ios/\n' > apps/mobile/.gitignore
  printf '%s\n' "$pkg_body" > apps/mobile/package.json
  echo x > apps/mobile/src/a.ts
  git add -A
  git commit -qm base
}

case_run() { # case_run <ok|fail> <label> [substring the message must name]
  local want="$1" label="$2" needle="${3:-}" out rc
  set +e
  out="$("$script" 2>&1)"
  rc=$?
  set -e
  if [ "$want" = ok ]; then
    [ "$rc" = 0 ] || { echo "FAIL: $label: expected it to pass, got exit $rc: $out"; fail=1; }
  else
    [ "$rc" != 0 ] || { echo "FAIL: $label: expected it to fail"; fail=1; }
  fi
  if [ -n "$needle" ] && [[ "$out" != *"$needle"* ]]; then
    echo "FAIL: $label: message does not mention '$needle': $out"
    fail=1
  fi
}

# a tree with no prebuild output
fresh
case_run ok "clean tree"

# the same script values in a differently formatted file must still pass: only the values matter
fresh
printf '%s\n' '{ "scripts": { "android": "expo start --android" } }' > apps/mobile/package.json
git add -A && git commit -qm "reformat package.json"
case_run ok "reformatted package.json"

# tracked prebuild output (git add -f: prebuild output is ignored once the rules are in place)
fresh
mkdir -p apps/mobile/android/app
echo 'apply plugin: "com.android.application"' > apps/mobile/android/app/build.gradle
git add -f apps/mobile/android/app/build.gradle && git commit -qm "android"
case_run fail "committed apps/mobile/android" "apps/mobile/android/app/build.gradle"

fresh
mkdir -p apps/mobile/ios
echo 'platform :ios' > apps/mobile/ios/Podfile
git add -f apps/mobile/ios/Podfile && git commit -qm "ios"
case_run fail "committed apps/mobile/ios" "apps/mobile/ios/Podfile"

# the package.json prebuild writes
fresh
printf '{"scripts": {"android": "expo run:android"}}' > apps/mobile/package.json
git add -A && git commit -qm "prebuilt package.json"
case_run fail "scripts.android is 'expo run:android'" "expo run:android"

fresh
printf '{\n  "scripts": {\n    "ios": "expo run:ios"\n  }\n}\n' > apps/mobile/package.json
git add -A && git commit -qm "prebuilt package.json"
case_run fail "scripts.ios is 'expo run:ios'" "expo run:ios"

# ignore rules removed
fresh
printf 'node_modules/\n' > apps/mobile/.gitignore
git add -A && git commit -qm "drop the ignore rules"
case_run fail "apps/mobile/.gitignore has no /android/" "apps/mobile/android/ is not ignored"

# unanchored rules still ignore the app's own android/ and ios/, but also the native modules' source
for dir in android ios; do
  fresh
  printf 'node_modules/\n%s/\n' "$dir" > apps/mobile/.gitignore
  git add -A && git commit -qm "unanchored $dir rule"
  case_run fail "unanchored $dir/ rule" "apps/mobile/modules/x/$dir/"
done

[ "$fail" = 0 ] && echo "check-prebuild-output: all sample trees OK"
exit "$fail"
