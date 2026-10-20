#!/usr/bin/env bash
# Checks how android-release.yml and web-deploy.yml pass the error-tracking and site variables (#827). Every rule is an
# exact comparison, so swapping production and staging, a constant, a dropped argument or a blanked variable fails:
#   - EXPO_PUBLIC_SENTRY_DSN / _SENTRY_ENVIRONMENT / _SITE_URL are set only on the step that bundles the app (Gradle,
#     expo export), never at workflow or job level and never on a step that runs npm ci;
#   - the environment name is exactly `production` on a v* tag, else `staging`, and on web equals the deploy job's
#     `environment:` expression; the DSN and site URL come from `vars`; on Android the DSN is blank on pull requests
#     (no environment there, so a repository-level variable must not reach debug-signed artifacts), on web the deploy job
#     never runs on pull requests;
#   - a check step BEFORE the bundling step runs check-site-url.sh (release/production builds need the site URL) and, on
#     web, check-sentry-origin.sh with both the origin and the DSN;
#   - the feature flags EXPO_PUBLIC_BARCODE_SCAN, _POSE_TRACKING and _EXERCISE_MOTION are held to the same rules (a duplicate on another step
#     or at job or workflow level fails), come from `vars` on that step, and on Android are blank on pull requests;
#   - web tag builds stamp the tag's version (without the v) into app.json before expo export.
# Needs python3 with PyYAML (present on GitHub's Ubuntu runners). Run from anywhere: infra/scripts/test-release-env.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
python3 -I - "$root/.github/workflows/android-release.yml" "$root/.github/workflows/web-deploy.yml" <<'PY'
import sys, yaml

flags = ["EXPO_PUBLIC_BARCODE_SCAN", "EXPO_PUBLIC_POSE_TRACKING", "EXPO_PUBLIC_EXERCISE_MOTION"]
names = ["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_SENTRY_ENVIRONMENT", "EXPO_PUBLIC_SITE_URL"] + flags
bundlers = {"android-release.yml": "gradlew", "web-deploy.yml": "expo export"}
TAG_ENV = "${{ startsWith(github.ref, 'refs/tags/v') && 'production' || 'staging' }}"
IS_TAG = "${{ startsWith(github.ref, 'refs/tags/v') }}"
DSN = "${{ vars.EXPO_PUBLIC_SENTRY_DSN }}"
DSN_ANDROID = "${{ github.event_name != 'pull_request' && vars.EXPO_PUBLIC_SENTRY_DSN || '' }}"
SITE = "${{ vars.EXPO_PUBLIC_SITE_URL }}"
FLAG_ANDROID = "${{ github.event_name != 'pull_request' && vars.%s || '' }}"
FLAG_WEB = "${{ vars.%s }}"
bad = []


def check(cond, msg):
    if not cond:
        bad.append(msg)


def index(steps, pred):
    hits = [i for i, s in enumerate(steps) if pred(s)]
    return hits


for path in sys.argv[1:]:
    wf = yaml.safe_load(open(path))
    base = path.rsplit("/", 1)[-1]
    check(not any(n in (wf.get("env") or {}) for n in names), f"{base}: a variable is set at workflow level")
    for jname, job in wf["jobs"].items():
        check(not any(n in (job.get("env") or {}) for n in names), f"{base}: {jname} sets a variable at job level")
        steps = job.get("steps", [])
        found = 0
        build_idx = None
        for i, step in enumerate(steps):
            env = step.get("env") or {}
            if not any(n in env for n in names):
                continue
            found += 1
            build_idx = i
            run = step.get("run", "")
            sid = step.get("name", "?")
            check("npm ci" not in run and "npm install" not in run, f"{base}: step '{sid}' passes a variable to an install")
            check(bundlers[base] in run, f"{base}: step '{sid}' is not the bundling step")
            want_dsn = DSN_ANDROID if base == "android-release.yml" else DSN
            check(env.get("EXPO_PUBLIC_SENTRY_DSN") == want_dsn, f"{base}: the DSN must be exactly {want_dsn}")
            check(env.get("EXPO_PUBLIC_SITE_URL") == SITE, f"{base}: the site URL must be exactly {SITE}")
            for flag in flags:
                want = (FLAG_ANDROID % flag) if base == "android-release.yml" else (FLAG_WEB % flag)
                check(env.get(flag) == want, f"{base}: {flag} must be exactly {want}")
            check(env.get("EXPO_PUBLIC_SENTRY_ENVIRONMENT") == TAG_ENV,
                  f"{base}: the environment must be exactly {TAG_ENV}")
        if base == "android-release.yml" and jname == "build":
            check(found == 1, f"{base}: expected the variables on exactly one step, found {found}")
            site = index(steps, lambda s: s.get("run", "").strip().startswith("../../infra/scripts/check-site-url.sh"))
            check(len(site) == 1 and build_idx is not None and site[0] < build_idx,
                  f"{base}: one check-site-url.sh step must come before the bundling step")
            if site:
                st = site[0]
                check(steps[st]["run"].strip() == '../../infra/scripts/check-site-url.sh "$IS_RELEASE" "$SITE_URL_CHECK"',
                      f"{base}: the site check must be check-site-url.sh \"$IS_RELEASE\" \"$SITE_URL_CHECK\"")
                e = steps[st].get("env") or {}
                check(e.get("IS_RELEASE") == IS_TAG, f"{base}: IS_RELEASE must be exactly {IS_TAG}")
                check(e.get("SITE_URL_CHECK") == SITE, f"{base}: SITE_URL_CHECK must be exactly {SITE}")
        if base == "web-deploy.yml" and jname == "deploy":
            check(found == 1, f"{base}: expected the variables on exactly one step, found {found}")
            check(job.get("environment") == TAG_ENV, f"{base}: the deploy environment must be exactly {TAG_ENV}")
            check("github.event_name != 'pull_request'" in job.get("if", ""),
                  f"{base}: the deploy job must never run on a pull request (it holds the DSN)")
            chk = index(steps, lambda s: "check-sentry-origin.sh" in s.get("run", ""))
            check(len(chk) == 1 and build_idx is not None and chk[0] < build_idx,
                  f"{base}: one check step must run check-sentry-origin.sh before the build step")
            if chk:
                st = steps[chk[0]]
                lines = [l.strip() for l in st["run"].splitlines()]
                check('infra/scripts/check-sentry-origin.sh "$WEB_SENTRY_ORIGIN" "$SENTRY_DSN_CHECK"' in lines,
                      f"{base}: the call must be check-sentry-origin.sh \"$WEB_SENTRY_ORIGIN\" \"$SENTRY_DSN_CHECK\"")
                check('infra/scripts/check-site-url.sh "$IS_PRODUCTION" "$SITE_URL_CHECK"' in lines,
                      f"{base}: the call must be check-site-url.sh \"$IS_PRODUCTION\" \"$SITE_URL_CHECK\"")
                e = st.get("env") or {}
                check(e.get("SENTRY_DSN_CHECK") == DSN, f"{base}: SENTRY_DSN_CHECK must be exactly {DSN}")
                check(e.get("WEB_SENTRY_ORIGIN") == "${{ vars.WEB_SENTRY_ORIGIN }}",
                      f"{base}: WEB_SENTRY_ORIGIN must come from vars.WEB_SENTRY_ORIGIN")
                check(e.get("SITE_URL_CHECK") == SITE, f"{base}: SITE_URL_CHECK must be exactly {SITE}")
                check(e.get("IS_PRODUCTION") == IS_TAG, f"{base}: IS_PRODUCTION must be exactly {IS_TAG}")
            stamp = index(steps, lambda s: "expo.version" in s.get("run", ""))
            check(len(stamp) == 1 and build_idx is not None and stamp[0] < build_idx,
                  f"{base}: one step must stamp expo.version before expo export")
            if stamp:
                st = steps[stamp[0]]
                check(st.get("if") == "github.ref_type == 'tag'", f"{base}: the version stamp must run only on tags")
                check((st.get("env") or {}).get("REF_NAME") == "${{ github.ref_name }}",
                      f"{base}: the stamp must read the tag from github.ref_name")
                check('VERSION="${REF_NAME#v}"' in st["run"], f"{base}: the stamp must strip the v from the tag")
                check("app.json" in st["run"] and st.get("working-directory") == "apps/mobile",
                      f"{base}: the stamp must edit apps/mobile/app.json")
if bad:
    print("FAIL:\n  " + "\n  ".join(bad))
    sys.exit(1)
print("release workflow variables ok")
PY
