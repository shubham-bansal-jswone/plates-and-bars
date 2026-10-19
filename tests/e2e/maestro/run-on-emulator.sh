#!/usr/bin/env bash
# Installs the APK ($APK_PATH) on the running emulator and runs every flow in this folder, one `maestro test` per flow. Output goes
# to $RUNNER_TEMP/maestro-out (CI uploads it on failure). Used by .github/workflows/android-smoke.yml; locally:
# APK_PATH=app.apk tests/e2e/maestro/run-on-emulator.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${RUNNER_TEMP:-/tmp}/maestro-out"
pkg=app.plateandbar.mobile
mkdir -p "$out"
adb install -r "$APK_PATH"

# Stop the app and wait until Android has no process and no task left for it. Starting the next flow while the previous flow's task
# is still being removed gets the new process killed ("remove task") before it attaches, and the app then sits on its splash
# screen (#1064, analysis in https://github.com/shubham-bansal-jswone/plates-and-bars/issues/1064#issuecomment-6266359373).
settle_app() {
  adb shell am force-stop "$pkg"
  local pid tasks
  for _ in $(seq 1 60); do
    pid="$(adb shell pidof "$pkg" | tr -d '\r' || true)"
    # a task shows as "Task{... A=<uid>:<package>}"; mLastFocusedRootTask is only a stale pointer to the last one and stays after
    # the task is gone. grep -c reads all of dumpsys, so adb never dies of SIGPIPE under pipefail
    tasks="$(adb shell dumpsys activity activities | grep -v mLastFocusedRootTask | grep -c "A=[0-9]*:$pkg" || true)"
    if [ -z "$pid" ] && [ "$tasks" = 0 ]; then
      return 0
    fi
    sleep 0.5
  done
  echo "::warning::$pkg still has a process or task 30 s after force-stop (pid='$pid', matching task lines: $tasks)"
  adb shell dumpsys activity activities | grep -v mLastFocusedRootTask | grep "A=[0-9]*:$pkg" | head -5 || true
}

rc=0
for flow in "$here"/[0-9]*.yaml; do
  name="$(basename "$flow" .yaml)"
  settle_app
  timeout 10m maestro test --format junit --output "$out/report-$name.xml" --debug-output "$out/debug/$name" --flatten-debug-output "$flow" || rc=$?
done

# The setup subflow relaunches the app once when it still stays on the splash screen (#1064). Say so in the run, passed or not:
# Maestro lists the relaunch (label SPLASH-RELAUNCH) as a completed launchApp in a flow's commands.json only when the branch ran.
python3 -I - "$out/debug" <<'PY'
import json, pathlib, sys
for f in sorted(pathlib.Path(sys.argv[1]).rglob("commands.json")):
    for c in json.load(open(f)):
        command = c.get("command", {})
        if "runFlowCommand" not in command and "SPLASH-RELAUNCH" in json.dumps(command) and c.get("metadata", {}).get("status") == "COMPLETED":
            print(f"::warning::{f.parent.name}: app stuck on the splash screen, relaunched once (#1064)")
PY
exit "$rc"
