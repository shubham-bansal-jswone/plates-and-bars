#!/usr/bin/env bash
# Installs the APK ($APK_PATH) on the running emulator and runs every flow in this folder. Output goes to $RUNNER_TEMP/maestro-out
# (CI uploads it on failure). Used by .github/workflows/android-smoke.yml; locally: APK_PATH=app.apk tests/e2e/maestro/run-on-emulator.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${RUNNER_TEMP:-/tmp}/maestro-out"
mkdir -p "$out"
adb install -r "$APK_PATH"
rc=0
timeout 25m maestro test --format junit --output "$out/report.xml" --debug-output "$out/debug" --flatten-debug-output "$here" || rc=$?

# The setup subflow relaunches the app once when it stays on the splash screen (#1064). Say so in the run, passed or not: Maestro
# lists the relaunch (label SPLASH-RELAUNCH) as a completed launchApp in a flow's commands.json only when the branch ran.
python3 -I - "$out/debug" <<'PY'
import json, pathlib, sys
for f in sorted(pathlib.Path(sys.argv[1]).glob("*/commands.json")):
    for c in json.load(open(f)):
        command = c.get("command", {})
        if "runFlowCommand" not in command and "SPLASH-RELAUNCH" in json.dumps(command) and c.get("metadata", {}).get("status") == "COMPLETED":
            print(f"::warning::{f.parent.name}: app stuck on the splash screen, relaunched once (#1064)")
PY
exit "$rc"
