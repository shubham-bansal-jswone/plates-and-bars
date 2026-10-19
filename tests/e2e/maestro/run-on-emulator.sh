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
  adb shell am force-stop "$pkg" || { echo "::error::adb force-stop failed"; exit 1; }
  local pid pid_rc dump tasks
  for _ in $(seq 1 60); do
    # pidof exits 1 when there is no process; any other status (adb prints "error:" and exits 255) means adb failed: stop the script
    pid_rc=0
    pid="$(adb shell pidof "$pkg")" || pid_rc=$?
    if [ "$pid_rc" -gt 1 ]; then
      echo "::error::adb shell pidof failed with status $pid_rc"
      exit 1
    fi
    pid="${pid//$'\r'/}"
    # if adb itself fails the script stops here, it is never read as "no task left" (explicit, because set -e is off while this
    # function runs as the condition of an `if`)
    dump="$(adb shell dumpsys activity activities)" || { echo "::error::adb shell dumpsys failed"; exit 1; }
    # a task shows as "Task{... A=<uid>:<package>}"; mLastFocusedRootTask is only a stale pointer to the last one and stays after
    # the task is gone
    tasks="$(grep -v mLastFocusedRootTask <<<"$dump" | grep -c "A=[0-9]*:$pkg" || true)"
    if [ -z "$pid" ] && [ "$tasks" = 0 ]; then
      return 0
    fi
    sleep 0.5
  done
  echo "::error::$pkg still has a process or task 30 s after force-stop (pid='$pid', matching task lines: $tasks); this flow is failed"
  grep -v mLastFocusedRootTask <<<"$dump" | grep "A=[0-9]*:$pkg" | head -5 || true
  return 1
}

rc=0
for flow in "$here"/[0-9]*.yaml; do
  name="$(basename "$flow" .yaml)"
  # a flow that cannot start from a settled app counts as failed (the run must not go green on a warning), the others still run
  if ! settle_app; then
    rc=1
    continue
  fi
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
