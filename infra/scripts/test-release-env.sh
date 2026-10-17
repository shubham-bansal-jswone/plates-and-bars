#!/usr/bin/env bash
# Checks how android-release.yml and web-deploy.yml pass the error-tracking and site variables (#827): the three
# EXPO_PUBLIC_SENTRY_DSN / _SENTRY_ENVIRONMENT / _SITE_URL names are set only on the step that bundles the app (Gradle,
# expo export), never at workflow or job level and never on a step that runs npm ci; the DSN and site URL come from
# `vars` (optional, empty = off), the environment name from the tag; the web deploy cross-checks the DSN against
# WEB_SENTRY_ORIGIN before building. Needs python3 with PyYAML (present on GitHub's Ubuntu runners).
# Run from anywhere: infra/scripts/test-release-env.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
python3 -I - "$root/.github/workflows/android-release.yml" "$root/.github/workflows/web-deploy.yml" <<'PY'
import sys, yaml

names = ["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_SENTRY_ENVIRONMENT", "EXPO_PUBLIC_SITE_URL"]
bundlers = {"android-release.yml": "gradlew", "web-deploy.yml": "expo export"}
bad = []
for path in sys.argv[1:]:
    wf = yaml.safe_load(open(path))
    base = path.rsplit("/", 1)[-1]
    if any(n in (wf.get("env") or {}) for n in names):
        bad.append(f"{base}: a variable is set at workflow level")
    for jname, job in wf["jobs"].items():
        if any(n in (job.get("env") or {}) for n in names):
            bad.append(f"{base}: {jname} sets a variable at job level")
        found = 0
        for step in job.get("steps", []):
            env = step.get("env") or {}
            if not any(n in env for n in names):
                continue
            found += 1
            run = step.get("run", "")
            sid = step.get("name", "?")
            if "npm ci" in run or "npm install" in run:
                bad.append(f"{base}: step '{sid}' passes a variable to an install")
            if bundlers[base] not in run:
                bad.append(f"{base}: step '{sid}' is not the bundling step")
            if "EXPO_PUBLIC_SENTRY_DSN" in env and env["EXPO_PUBLIC_SENTRY_DSN"] != "${{ vars.EXPO_PUBLIC_SENTRY_DSN }}":
                bad.append(f"{base}: the DSN must come from vars.EXPO_PUBLIC_SENTRY_DSN")
            if env.get("EXPO_PUBLIC_SITE_URL") != "${{ vars.EXPO_PUBLIC_SITE_URL }}":
                bad.append(f"{base}: the site URL must come from vars.EXPO_PUBLIC_SITE_URL")
            e = env.get("EXPO_PUBLIC_SENTRY_ENVIRONMENT", "")
            if "refs/tags/v" not in e or "'production'" not in e or "'staging'" not in e:
                bad.append(f"{base}: the environment must be production on v* tags, else staging")
            if "EXPO_PUBLIC_SENTRY_DSN" not in env:
                bad.append(f"{base}: the DSN is missing from the bundling step")
        if base == "android-release.yml" and jname == "build" and found != 1:
            bad.append(f"{base}: expected the variables on exactly one step, found {found}")
        if base == "web-deploy.yml" and jname == "deploy":
            if found != 1:
                bad.append(f"{base}: expected the variables on exactly one step, found {found}")
            text = yaml.safe_dump(job)
            if "check-sentry-origin.sh" not in text or "WEB_SENTRY_ORIGIN" not in text:
                bad.append(f"{base}: the DSN is not cross-checked against WEB_SENTRY_ORIGIN")
if bad:
    print("FAIL:\n  " + "\n  ".join(bad))
    sys.exit(1)
print("release workflow variables ok")
PY
