#!/usr/bin/env bash
# Checks the ccache rules of android-release.yml: the size cap is 2G in both places that set it, the cache is saved only on
# main and never on a pull request, and the job that deletes old ccache entries (the only one with `actions: write`) never
# runs on a pull request, runs only on main after a green build, and keeps only the newest entry. The job's `if:` must equal the exact intended expression.
# Run from anywhere: infra/scripts/test-android-ccache.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
python3 -I - "$root/.github/workflows/android-release.yml" <<'PY'
import sys, yaml

wf = yaml.safe_load(open(sys.argv[1]))
bad = []


def check(cond, msg):
    if not cond:
        bad.append(msg)


build = wf["jobs"]["build"]
prune = wf["jobs"].get("ccache-prune")
check("actions" not in (wf.get("permissions") or {}), "workflow-level permissions must not include actions")
check("actions" not in (build.get("permissions") or {}), "the build job must not get actions permissions")
check(prune is not None, "ccache-prune job is missing")
for jname, job in wf["jobs"].items():
    if jname != "ccache-prune":
        check("actions" not in (job.get("permissions") or {}), f"{jname}: only ccache-prune may have actions permissions")
        for st in job.get("steps", []):
            check("gh cache delete" not in st.get("run", ""), f"{jname}: cache deletion belongs in ccache-prune")

steps = build["steps"]
cap = [s for s in steps if "ccache -M" in s.get("run", "")]
check(len(cap) == 1 and "ccache -M 2G -z" in cap[0]["run"], "ccache.conf cap must be set by `ccache -M 2G -z`")
env_caps = [(s.get("env") or {}).get("CCACHE_MAXSIZE") for s in steps if "CCACHE_MAXSIZE" in (s.get("env") or {})]
check(env_caps == ["2G"], f"CCACHE_MAXSIZE must be 2G on exactly the build step, got {env_caps}")

saves = [s for s in steps if str(s.get("uses", "")).startswith("actions/cache/save@")]
check(len(saves) == 1, "expected exactly one cache save step")
for s in saves:
    cond = s.get("if", "")
    check("github.event_name != 'pull_request'" in cond and "github.ref == 'refs/heads/main'" in cond,
          "the ccache save must be limited to non-PR runs on main")

if prune:
    cond = prune.get("if", "")
    norm = " ".join(str(cond).replace("${{", "").replace("}}", "").split())
    want = "github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && needs.build.result == 'success'"
    check(norm == want, f"ccache-prune if: must be exactly: {want} (got: {norm})")
    check(prune.get("needs") == "build", "ccache-prune must need the build job")
    check(prune.get("permissions") == {"actions": "write"}, "ccache-prune permissions must be exactly actions: write")
    run = "\n".join(s.get("run", "") for s in prune["steps"])
    check("--key ccache-" in run and "'.[1:][]" in run, "ccache-prune must skip only the newest and list only ccache- keys")
    check("--sort created_at --order desc" in run, "ccache-prune must sort newest first")
    check(all(st.get("shell") == "bash" for st in prune["steps"] if "gh cache list" in st.get("run", "")),
          "the step running gh cache list must set shell: bash (pipefail)")
    check("gh cache delete" in run, "ccache-prune must delete with gh cache delete")
    check(not any(str(s.get("uses", "")).startswith("actions/checkout") for s in prune["steps"]),
          "ccache-prune needs no checkout")

if bad:
    print("FAIL:\n  " + "\n  ".join(bad))
    sys.exit(1)
print("android ccache rules ok")
PY
