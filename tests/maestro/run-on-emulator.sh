#!/usr/bin/env bash
# Installs the APK ($APK_PATH) on the running emulator and runs every flow in this folder. Output goes to $RUNNER_TEMP/maestro-out
# (CI uploads it on failure). Used by .github/workflows/android-smoke.yml; locally: APK_PATH=app.apk tests/maestro/run-on-emulator.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${RUNNER_TEMP:-/tmp}/maestro-out"
mkdir -p "$out"
adb install -r "$APK_PATH"
maestro test --format junit --output "$out/report.xml" --debug-output "$out/debug" --flatten-debug-output "$here"
