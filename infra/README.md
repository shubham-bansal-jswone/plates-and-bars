# Infra

CI and security automation for Plate & Bar. Owned by the Infra lane (`infra/`, `.github/workflows/`). Staging config (Compose, backup script, runbook) is in `infra/staging/` and `infra/RUNBOOK.md` (#36). The staging deploy workflow (#411) is inert until the owner enables it (see Staging deploy).

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, push to `main` | `changes` job decides which jobs apply; `api`, `core`, `mobile`, `tools`, `backend` run only when relevant |
| `.github/workflows/staging-config.yml` | PR touching `infra/staging/` or `infra/caddy/` | `docker compose config` with `.env.example`, each required secret has no default, `shellcheck`, `test-backup.sh` (backup.sh against a stub docker), `test-deploy.sh` (deploy.sh against stubs: success, rollback on a failed `compose up` or health check, nothing to roll back to, failed build), images pinned (including rclone in `backup.sh`) (not a required check) |
| `.github/workflows/staging-deploy.yml` | push to `main` touching `backend/`, `content/`, `packages/api/openapi.yaml`, `infra/staging/` or the API Caddyfile; manual | SSH to the staging VM, fast-forward to the pushed commit, run `infra/staging/deploy.sh`; skipped until repository variable `STAGING_DEPLOY_ENABLED` is `true` (see Staging deploy) |
| `.github/workflows/lane-check.yml` | PR | Warns (never fails) when a PR touches more than one lane in the `docs/AGENTS.md` Lanes table |
| `.github/workflows/site-deploy.yml` | push to `main` touching `apps/site`, manual (deploys); PR touching `infra/caddy/` (validate only) | Builds `apps/site` and deploys it; every job is skipped until repository variable `SITE_DEPLOY_TARGET` is set (see below) |
| `.github/workflows/android-release.yml` | tag `v*`, manual, PR touching the workflow | `expo prebuild` + Gradle `assembleRelease bundleRelease`; uploads APK and AAB as an artifact (see below) |
| `.github/workflows/security.yml` | PR, push to `main`, weekly | gitleaks secret scan, dependency review (PRs) |
| `.github/dependabot.yml` | weekly | Updates for GitHub Actions, npm (`packages/api`, `packages/core`, `apps/mobile`, `tools`) and `backend` (gradle) |

Why one `ci.yml` instead of a workflow per folder with `on.paths`: a path-filtered workflow that does not trigger never reports, so a required check would stay "pending" forever. Instead, `infra/scripts/detect-changes.sh` does the path filtering and non-applicable jobs are skipped, which branch protection treats as passing.

On PRs both scripts diff `HEAD^1` against `HEAD`: CI checks out the tested merge commit, whose first parent is the current tip of the base branch, so a base that moved after the PR was opened does not add unrelated files. If the rev does not resolve, `detect-changes.sh` runs every job and `lane-check.sh` skips with a notice. The scripts use the three-dot form (`base...HEAD`), which equals the plain diff for `HEAD^1` on a merge commit and, locally with `origin/main`, ignores files main gained since you branched. `lane-check.sh` with no argument uses the merge base with `origin/main`.

A job runs when (a) its folder contains the build file below and (b) the PR touched the folder or something it depends on (or `ci.yml` / `infra/scripts/`). Pushes to `main` run every job whose folder exists. Until a folder has its build file the job is skipped.

## What each lane must provide

CI runs exactly these commands from the folder. Match them; do not expect other commands.

| Folder | Detected by | Commands | Also runs when |
| --- | --- | --- | --- |
| `packages/api` | `package.json` | `npm ci`, `npm run check` (lint, generate, stale diff, typecheck), untracked-files check on `client/`; plus `npm audit --audit-level=high --omit=dev` as the separate `npm audit (api)` job | |
| `packages/core` | `package.json` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | `packages/api`, `content/` (drift test), `docs/spec/golden/` or `docs/prototype/` changes |
| `apps/mobile` | `package.json` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npx expo export --platform web` (catches Metro resolution breaks) | `packages/core`, `packages/api` or `content/` changes (the app imports the content files) |
| `tools` | `package.json` | `npm ci`, `npm run lint`, `npm test`, `node validate/cli.mjs` (Node 22; whatever those scripts and validator CLIs cover) | `content/`, `docs/spec/golden/` or `docs/prototype/` changes |
| `backend` | `build.gradle` or `build.gradle.kts` | `./gradlew build --no-daemon` (JDK 21 Temurin; Docker is available for Testcontainers) | `packages/api/openapi.yaml`, `packages/api/test-vectors/` or any `content/` change (the build bundles every `content/*.json`; `backend/scripts` is inside `backend/`) |

Requirements for the TS packages: Node 22 LTS, a committed `package-lock.json` (needed by `npm ci` and the npm cache), and the scripts `lint`, `typecheck`, `test` in `package.json`. For `backend`: a committed Gradle wrapper (`gradlew`, executable) and tests wired into `build`. If the lane needs different commands or a Node/JDK version, change them via an Infra issue.

### Content record check (`content-meta`)

`apps/mobile/src/content/bundled.json` records each content file's sha256, `schema_version` and `updated_at`. The `content-meta (bundled.json)` job runs `node scripts/content-meta.mjs --check` in `apps/mobile` when `content/`, `apps/mobile/src/content/` or the script change. The checkout is always shallow, so the script cannot recompute dates: it compares hashes and schema versions exactly, and checks only that each `updated_at` is a well-formed UTC time no later than HEAD's commit. A PR cannot know its own squash-merge date, and comparing exact dates on `main` would turn it red after every content merge. A stale `updated_at` is normally older than the real merge date. That costs nothing on a device with no stored server copy (refresh compares hashes first). A device holding a server copy dated between the stale date and the merge date keeps that older copy for one launch, then downloads bytes the build already ships. Regenerate with `node scripts/content-meta.mjs` on a full-history `main` and commit the result before each mobile release build. A malformed or future date fails the check (#412), because the app would reject every server copy of that bundle.

`infra/scripts/test-detect-changes.sh` (run by the `changes` job) feeds sample diffs to `detect-changes.sh` in a throwaway repo and fails if a job is enabled or skipped wrongly.

### Stale generated client

`npm run check` in the `api` job regenerates `packages/api/client/schema.d.ts` from `openapi.yaml` and fails with an explicit message if that changes the tracked file or leaves untracked files in `client/`. Fix: run `npm run generate` in `packages/api` and commit.

### Lane check

`infra/scripts/lane-check.sh` parses the Lanes table in `docs/AGENTS.md` (the backticked paths in the "Owns" column), maps each changed file to its lane and emits a `::warning::` annotation if more than one lane is touched. Files outside every lane (root files, `docs/` outside `docs/adr/`) are ignored. Contract PRs (`packages/api` plus `docs/adr`) are one lane in the table, so they pass without a warning. If the table format changes, the script fails loudly rather than silently passing.

### Secret and dependency scanning

- gitleaks (v8.30.1, binary downloaded and verified against a SHA-256 hard-coded in the workflow, no licence needed) scans only the PR's own commits on pull requests (`--log-opts="HEAD^1..HEAD"` on the tested merge commit, so a finding on another branch cannot fail unrelated PRs), main's full history (`--log-opts="HEAD"`) on push to `main`, and every branch and tag (`--log-opts="--all"`) in the weekly scheduled run, which fails only that run and never blocks a PR, with the root `.gitleaks.toml`. That file allowlists only the `jwt` rule, only for `packages/api/openapi.yaml` and `packages/api/client/schema.d.ts`, because the contract's examples contain deliberately fake JWTs (`id_token`, access tokens). It is path-based, not fingerprint-based, so changing the examples needs no update; a second entry allowlists `generic-api-key` in the same files only on lines naming `access_token`, `refresh_token` or `id_token` (the same fake examples). Every other rule, and `generic-api-key` on other lines, stays active.
- `dependency-review-action` fails PRs that add dependencies with known high-severity advisories (free on public repos; checked 2026-10-08 that this repo is public).
- Dependabot entries (weekly): GitHub Actions, npm for `packages/api`, `packages/core`, `apps/mobile`, `apps/site` and `tools`, and gradle for `backend`. Ignores: `typescript` semver-major in `packages/api` and `packages/core`; `gradle/actions/*` semver-major (Dependabot names the action `gradle/actions/setup-gradle`; see Pins); `org.springframework.boot` semver-major on `backend` (until the Boot 4 migration); `com.networknt:json-schema-validator` versions `>=3` on `backend` (Jackson 3, needs Boot 4, #81; migration in #416); `@types/node` versions `>=23` in the TS lanes (`packages/api`, `packages/core`, `apps/mobile`, `apps/site`, CI runs Node 22), not in `/tools`; every Expo-managed package in `apps/mobile` (`expo*`, `@expo/*`, `react`, `react-dom`, `react-test-renderer`, `react-native*`, `jest-expo`, `eslint-config-expo`, `@types/react`, `@types/jest`) — the Expo SDK pins exact React and native versions, so they move together in the SDK upgrade (#58) and their security advisories arrive through that path (`@expo-google-fonts/*` is deliberately not matched: it versions independently); and `eslint` semver-major in `apps/mobile`, the only folder using it (eslint-plugin-react does not support ESLint 10). Infra adds an `npm` entry to `.github/dependabot.yml` when a new npm folder lands (other lanes do not edit it), because Dependabot errors on directories that do not exist yet.
- Recommended, a setting rather than code: enable Secret scanning and Push protection under Settings, Code security.

## Branch protection for `main` (to be set by Shubham)

Settings, Branches, rule for `main`: require a pull request, require status checks to pass, require branches to be up to date. Required checks (names as shown in the checks list):

- `changes`
- `api (lint, types, stale client)`
- `core (lint, types, tests)`
- `mobile (lint, types, tests)`
- `tools (lint, tests, validate)`
- `site (build, check, a11y)`
- `backend (gradle build)`
- `gitleaks`
- `dependency-review`
- `npm audit (api)`

Do not require `lane-check (warns only)`; it only annotates. Skipped jobs (folder absent or untouched) count as passing, so requiring all of the above is safe now. Note that `dependency-review` only runs on PRs, so it will not report on pushes to `main`; that is fine for PR-based protection.

The `site` job installs open-source Chromium (BSD-3-Clause) with `@puppeteer/browsers` (Apache-2.0, version pinned by `apps/site/package-lock.json`, run via `npx --no-install`) and sets `CHROME_PATH` to it; it does not use Google Chrome (proprietary, Google ToS). Licences checked 2026-10-09 (npm registry metadata for `@puppeteer/browsers`).

`chromium@latest` floats on purpose: puppeteer-core's `PUPPETEER_REVISIONS` lists only Chrome, Chrome Headless Shell and Firefox, not a Chromium build ID, so there is nothing to pin to. The a11y step also runs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` so the Chromium sandbox stays on (no `--no-sandbox`). If a runner image drops or renames that sysctl, a red `site` job is the intended signal; fix it rather than disabling the sandbox.

The `e2e` job (`tests/e2e`, #344) builds `apps/mobile` for web and runs Playwright (`@playwright/test`, Apache-2.0) against it with the same open-source Chromium install and AppArmor sysctl step as `site`; Playwright's own browser download is never run, the Chromium path is passed as `executablePath` (`CHROME_PATH`). axe-core is MPL-2.0 (already used by `site`). It runs when `tests/e2e`, `apps/mobile`, `packages/core`, `packages/api` or `content` change (`detect-changes.sh`). Add `e2e (web, Playwright)` to the required checks if wanted.

Pins: `gradle/actions/setup-gradle` is pinned to the full commit SHA of v6.4.0 with `cache-provider: basic`; other actions use major version tags. Dependabot proposes bumps, except `gradle/actions/*` majors (ignored, so a human re-checks the licence). Container images are pinned by exact version tag (`caddy:2.11.7` in `site-deploy.yml`); bump it by hand when a new Caddy release is wanted. gitleaks is pinned by version and a hard-coded SHA-256 in `security.yml`.

### setup-gradle licence decision (checked 2026-10-08)

Rule: open-source licences only. `gradle/actions` v6 is MIT except the vendored `gradle-actions-caching` library (proprietary, Gradle Technologies Terms of Use), which the default `cache-provider: enhanced` loads. With `cache-provider: basic` the action uses `BasicCacheService`, a wrapper over `@actions/cache` (MIT), and never imports the proprietary library (`getCacheService` in `sources/src/cache-service-loader.ts`; `NOTICE` and `DISTRIBUTION.md` say the same). We do not set the Build Scan terms inputs and do not publish scans. If a later major changes this, revert to v4.4.4 (`748248ddd2a24f49513d8f472f81c3a07d4d50e1`, MIT) and keep the Dependabot ignore.

## Local checks

```
actionlint
yamllint -d '{extends: relaxed, rules: {line-length: disable}}' .github
shellcheck infra/scripts/*.sh
infra/scripts/lane-check.sh origin/main
infra/scripts/detect-changes.sh origin/main
```

## Website deploy (#305)

The plan named Cloudflare Pages; that needs a vendor account and terms, so the workflow offers two open options instead. Nothing runs until you set the repository variable `SITE_DEPLOY_TARGET`.

| Value | What happens | You provide |
| --- | --- | --- |
| `github-pages` | `npm ci`, `check`, `build`, then `actions/deploy-pages` | Settings > Pages > Source: GitHub Actions; a custom domain (the site is built for the domain root, so the default `user.github.io/repo/` path would break asset links) |
| `caddy` | Build, then `rsync --delete` of `dist/` to the VM over SSH; Caddy serves it (`infra/caddy/Caddyfile.site`) | variables `SITE_SSH_HOST`, `SITE_SSH_USER`, `SITE_WEB_ROOT`; secrets `SITE_SSH_KEY` (private key of a deploy-only user), `SITE_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`); a GitHub environment named `site`, with deployment branches restricted to `main` (Settings > Environments > site) |

Caddy setup on the VM: install Caddy (Apache-2.0), put the Caddyfile in `/etc/caddy/Caddyfile` with your domain, create `/srv/site` owned by the deploy user, point DNS at the VM and open ports 80 and 443. Caddy gets the Let's Encrypt certificate itself. The workflow's `validate Caddyfile` job runs `caddy validate` with the pinned official Apache-2.0 Caddy image on both Caddyfiles on every PR touching `infra/caddy/` or `apps/site/public/_headers`, and `infra/scripts/check-caddy-headers.sh` fails it if a header in `_headers` is missing from, or differs in, `Caddyfile.site`, or if `Caddyfile.api` loses its `Strict-Transport-Security` header (`infra/scripts/test-check-caddy-headers.sh` tests the check). Caddy ignores `_headers`, so the CSP and security headers live in both; change them together. The Caddyfile sets long-lived immutable caching for `/_astro/*`, `no-cache` for everything else, and security headers.

Safety rails: deploys run only from `main`, even when started manually; the `caddy` job refuses to run `rsync --delete` unless `SITE_SSH_HOST`, `SITE_SSH_USER` and `SITE_WEB_ROOT` are set and `SITE_WEB_ROOT` is a directory under `/srv`, `/var/www` or `/opt` (for example `/srv/site`; never `/` or a home directory, because `rsync --delete` would remove `~/.ssh/authorized_keys`). Use a dedicated deploy user that can write only that directory.

### API host (`infra/caddy/Caddyfile.api`, #398)

Template for the API's Caddy: HSTS (`max-age=31536000`), `nosniff`, `X-Frame-Options`, `Referrer-Policy`, a deny-all CSP, only `/api/*` proxied (everything else 404), `request_body max_size 4MiB` (above the backend's default `SYNC_MAX_BODY_BYTES` of 2097152, so oversized requests get the backend's 400 `too_large` contract error rather than Caddy's 413; keep it above that variable if you raise it), and an active health check on `/api/v1/health`. Hostnames are placeholders: `API_HOST` (default `api.example.com`) and `API_UPSTREAM` (default `api:8080`).

`APP_RATELIMIT_TRUSTEDPROXIES` on the API must be the address or network the API sees Caddy connect from (the proxy directly in front of it), not Caddy's `trusted_proxies`:

| Layout | Value |
| --- | --- |
| Caddy and API in one Compose network | that network's subnet (staging pins `172.28.0.0/24`) |
| Caddy on the VM host, API published on `127.0.0.1:8080` | the Docker bridge gateway, usually `172.17.0.1` (`docker network inspect bridge`) |

Caddy's own `trusted_proxies` stays empty, so Caddy overwrites any client-sent `X-Forwarded-For` with the real peer. Add the ranges of any CDN placed in front later.

Open-source note: GitHub Pages is a GitHub service, already used for this repository; if you want it recorded as an exception, say so, otherwise choose `caddy`.

To turn it off again, delete the variable.

## Android release build (#304)

`android-release.yml` runs `expo prebuild --platform android` (the `android/` folder is generated in CI and never committed) and then `./gradlew assembleRelease bundleRelease`. It needs no account. Output: artifact `android-release` (APK and AAB, kept 14 days).

Signing is optional. `infra/scripts/android-signing.sh` patches the generated `android/app/build.gradle` only when all four secrets exist:

| Repository secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | upload keystore, base64 on one line (`base64 -w0 upload.jks`; on macOS `base64 -i upload.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Without them the build still passes and the artefacts are debug-signed: installable for testing, rejected by Google Play. If only some of the four are set, the build fails with an error rather than silently debug-signing. The script is idempotent and fails loudly if the Expo template changes and the patch no longer applies.

How the secrets are protected:

- Create a GitHub environment named `android-release` (Settings > Environments) and store the four secrets as environment secrets there, not repository secrets. Restrict its deployment branches and tags to `v*` tags (and `main` if you want manual builds) and optionally add yourself as a required reviewer.
- Tag and manual runs use that environment. `pull_request` runs use no environment and the workflow passes them empty secrets, so PR builds are always debug-signed even if the workflow is edited in a branch (a branch cannot reach environment secrets outside its allowed refs).
- Secrets are exposed only to the decode, signing and Gradle steps, never to `npm ci` or `expo prebuild`. The decoded keystore is written with mode 600 and deleted in a final `if: always()` step.
- Gradle caching uses the MIT `basic` provider of `gradle/actions/setup-gradle`, like `ci.yml`.

Generate the keystore with `keytool -genkeypair -v -storetype PKCS12 -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000` and keep it, with its passwords, somewhere safe outside the repo; losing the upload key is recoverable with Play support, but only if Play App Signing is on.

## Staging deploy (#411)

Nothing runs until the owner has a VM (`infra/RUNBOOK.md` section 1) and sets the repository variable `STAGING_DEPLOY_ENABLED` to `true`. Then every push to `main` that touches the backend, content, `packages/api/openapi.yaml` or staging files (and manual runs from `main`) deploys that commit. Needed:

| What | Name | Where |
| --- | --- | --- |
| Variable | `STAGING_DEPLOY_ENABLED` = `true` | repository variables |
| Variables | `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_DIR` (checkout on the VM, for example `/opt/plateandbar`) | environment `staging` |
| Secrets | `STAGING_SSH_KEY` (private key of a deploy-only user in the `docker` group), `STAGING_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`) | environment `staging`, deployment branches restricted to `main` |

The job runs `git fetch`, `git merge --ff-only <sha>` and `infra/staging/deploy.sh` on the VM. The script builds `plateandbar-api:<12-char sha>`, writes it to `API_TAG` in `.env`, runs `docker compose up -d` and polls `https://$API_HOST/api/v1/health` for up to 5 minutes (`HEALTH_TIMEOUT_SECONDS`). If `compose up` fails or it never turns healthy it restores the previous `API_TAG`, recreates the API and exits non-zero. The workflow does not re-run CI: branch protection on the PR is what gates the merge. A tagged production release with a pre-deploy backup is not part of this workflow.
