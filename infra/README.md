# Infra

CI and security automation for Plate & Bar. Owned by the Infra lane (`infra/`, `.github/workflows/`). Staging config (Compose, backup script, runbook) is in `infra/staging/` and `infra/RUNBOOK.md` (#36). The staging deploy workflow (#411) is inert until the owner enables it (see Staging deploy).

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, push to `main` | `changes` job decides which jobs apply; `api`, `core`, `mobile`, `tools`, `backend` run only when relevant |
| `.github/workflows/staging-config.yml` | PR touching `infra/staging/` or `infra/caddy/` | `docker compose config` with `.env.example`, each required secret has no default, `shellcheck`, `test-backup.sh` (backup.sh against a stub docker), `test-deploy.sh` (deploy.sh against stubs: success, rollback on a failed `compose up` or health check, nothing to roll back to, failed build, release tag), `test-release.sh` (release.sh: backup before deploy, no deploy after a failed backup), `test-restore-check.sh` (restore-check.sh, the monthly restore rehearsal: stale dump, failed load, missing Flyway table, cleanup), `test-ledger.sh` (the erasure ledger: `ledger-upload.sh` never overwrites a longer bucket copy, prunes at 45 days, keeps credentials off command lines; `ledger-replay.sh` deletes ledgered users and their email-keyed rows, skips and reports malformed lines, fails on a missing ledger), images pinned (including rclone in `backup.sh`) (not a required check) |
| `.github/workflows/monitoring-config.yml` | PR touching `infra/monitoring/`, `infra/caddy/Caddyfile.glitchtip` or `Caddyfile.kuma` | Inert GlitchTip and Uptime Kuma stacks (#828): `infra/monitoring/test-config.sh` (compose config with `.env.example`, required secrets without defaults, images pinned by version and digest, memory limits, privacy settings, Caddy log filters), `caddy validate`, a `linux/arm64` entry for every image; nothing is started or deployed (not a required check) |
| `.github/workflows/staging-deploy.yml` | push to `main` touching `backend/`, `content/`, `packages/api/openapi.yaml`, `infra/staging/` or `infra/caddy/`; manual | SSH to the staging VM, fast-forward to the pushed commit, run `infra/staging/deploy.sh`; skipped until repository variable `STAGING_DEPLOY_ENABLED` is `true` (see Staging deploy) |
| `.github/workflows/production-deploy.yml` | tag `v*`; PR touching `infra/staging/release.sh` (validate only) | SSH to the production VM, check out the tag, run `infra/staging/release.sh` (backup, then `deploy.sh` with the tag as image tag, health check, rollback); skipped until repository variable `PRODUCTION_DEPLOY_ENABLED` is `true` (see Production deploy) |
| `.github/workflows/lane-check.yml` | PR | Warns (never fails) when a PR touches more than one lane in the `docs/AGENTS.md` Lanes table |
| `.github/workflows/site-deploy.yml` | push to `main` touching `apps/site`, manual (deploys); PR touching `infra/caddy/` (validate only) | Builds `apps/site` and deploys it; every job is skipped until repository variable `SITE_DEPLOY_TARGET` is set (see below) |
| `.github/workflows/web-deploy.yml` | push to `main` (to `staging`), tag `v*` (to `production`), manual; PR touching `infra/caddy/` or the web scripts (validate only) | Builds `npx expo export --platform web` with `EXPO_PUBLIC_API_URL` and rsyncs `dist/` to the Caddy VM; skipped until repository variable `WEB_DEPLOY_ENABLED` is `true` (see Web app deploy) |
| `.github/workflows/android-release.yml` | tag `v*`, manual, PR touching the workflow, `apps/mobile/package-lock.json` or the licence tooling | `expo prebuild`, the Android licence-list check, Gradle `assembleRelease bundleRelease`; uploads APK and AAB as an artifact (see below) |
| `.github/workflows/security.yml` | PR, push to `main`, weekly | gitleaks secret scan, dependency review (PRs) |
| `.github/workflows/test-under-load.yml` | nightly 03:17 UTC, manual (never PRs) | `npm run test:load` in `apps/mobile`: the jest suite under CPU load (#660). Manual inputs `stall_ms` and `pattern` reach the shell only through `env:`; read-only token, no secrets, 45 minute timeout (not a required check) |
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

### Play listing check (`play listing`, #851)

`node docs/check-play-listing.mjs` checks `docs/PLAY-STORE-LISTING.md` against Google's character limits, leftover `[placeholder]` text, AI vendor or model names, and that the medical disclaimer matches `apps/mobile/src/setup/copy.ts` word for word. The `play listing (check)` job (Node only, no install) runs when `docs/PLAY-STORE-LISTING.md`, `docs/check-play-listing.mjs` or `apps/mobile/src/setup/copy.ts` change (`detect-changes.sh`). It is in the required list below: it is skipped, and so counts as passing, when none of them change.

### Golden fixtures check (`golden`, #29)

`docs/spec/golden/*.json` is generated from `docs/prototype/plate-and-bar.html` by `tools/golden-gen` and is never edited by hand. The `golden (fixtures match prototype)` job runs `node golden-gen/cli.mjs --check` in `tools` (no install, no dependencies) when `docs/spec/golden/`, `docs/prototype/` or `tools/golden-gen/` change, and fails if a fixture differs from what the prototype produces, so a hand edit, or a prototype change without regeneration, cannot merge. The other half, `packages/core` golden tests no longer matching the fixtures, is the `core` job (it also runs on those paths). `tools` re-checks the same thing through `golden-gen.test.mjs`; the separate job gives it its own name to require. Required checks for branch protection are listed below.

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
- `golden (fixtures match prototype)`
- `play listing (check)`
- `content-meta (bundled.json)`
- `e2e (web, Playwright)`
- `e2e (sync, Playwright + backend stack)`
- `site (build, check, a11y)`
- `backend (gradle build)`
- `gitleaks`
- `dependency-review`
- `npm audit (api)`

Do not require `lane-check (warns only)`; it only annotates. Skipped jobs (folder absent or untouched) count as passing, so requiring all of the above is safe now. Note that `dependency-review` only runs on PRs, so it will not report on pushes to `main`; that is fine for PR-based protection.

The `site` job installs open-source Chromium (BSD-3-Clause) with `@puppeteer/browsers` (Apache-2.0, version pinned by `apps/site/package-lock.json`, run via `npx --no-install`) and sets `CHROME_PATH` to it; it does not use Google Chrome (proprietary, Google ToS). Licences checked 2026-10-09 (npm registry metadata for `@puppeteer/browsers`).

`chromium@latest` floats on purpose: puppeteer-core's `PUPPETEER_REVISIONS` lists only Chrome, Chrome Headless Shell and Firefox, not a Chromium build ID, so there is nothing to pin to. The a11y step also runs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` so the Chromium sandbox stays on (no `--no-sandbox`). If a runner image drops or renames that sysctl, a red `site` job is the intended signal; fix it rather than disabling the sandbox.

The `e2e` job (`tests/e2e`, #344) builds `apps/mobile` for web and runs Playwright (`@playwright/test`, Apache-2.0) against it with the same open-source Chromium install and AppArmor sysctl step as `site`; Playwright's own browser download is never run, the Chromium path is passed as `executablePath` (`CHROME_PATH`). axe-core is MPL-2.0 (already used by `site`). It runs when `tests/e2e`, `apps/mobile`, `packages/core`, `packages/api` or `content` change (`detect-changes.sh`). Both e2e jobs are in the required list above.

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

Optional repository variable `PUBLIC_WEB_APP_URL` (#859): the web app's https origin with nothing after the host, for example `https://app.example.com`. The `build` job passes it to `npm run check` and `npm run build`; set, the landing page shows "Open the web app" and the deletion page "Delete on the web", unset or empty neither appears, so nothing changes until you set it. The build fails on any other value (`apps/site/src/lib/web-app-url.mjs`). Launch checklist: set it once the web app is hosted, at the same origin `web-deploy.yml` deploys to. The PR `site` job runs the a11y check twice, once without the variable and once with `PUBLIC_WEB_APP_URL=https://app.example.test`, so the pieces it adds are axe-checked too.

Caddy setup on the VM: install Caddy (Apache-2.0), put the Caddyfile in `/etc/caddy/Caddyfile` with your domain, create `/srv/site` owned by the deploy user, point DNS at the VM and open ports 80 and 443. Caddy gets the Let's Encrypt certificate itself. The workflow's `validate Caddyfile` job runs `caddy validate` with the pinned official Apache-2.0 Caddy image on both Caddyfiles on every PR touching `infra/caddy/` or `apps/site/public/_headers`, and `infra/scripts/check-caddy-headers.sh` fails it if a header in `_headers` is missing from, or differs in, `Caddyfile.site`, or if `Caddyfile.api` loses its `Strict-Transport-Security` header (`infra/scripts/test-check-caddy-headers.sh` tests the check). Caddy ignores `_headers`, so the CSP and security headers live in both; change them together. The Caddyfile sets long-lived immutable caching for `/_astro/*`, `no-cache` for everything else, and security headers.

Safety rails: deploys run only from `main`, even when started manually; the `caddy` job refuses to run `rsync --delete` unless `SITE_SSH_HOST`, `SITE_SSH_USER` and `SITE_WEB_ROOT` are set and `SITE_WEB_ROOT` is a directory under `/srv`, `/var/www` or `/opt` (for example `/srv/site`; never `/` or a home directory, because `rsync --delete` would remove `~/.ssh/authorized_keys`). Use a dedicated deploy user that can write only that directory.

### API host (`infra/caddy/Caddyfile.api`, #398)

Running this file alone (not through `Caddyfile.stack`): copy the global `log errors` block from `Caddyfile.stack` to its top, or Caddy's error lines, which carry the request, are written unfiltered (#714). The access log in the file is already filtered.

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

Licence list (#835). Between `expo prebuild` and the build, the job resolves `:app`'s `releaseRuntimeClasspath` with the plain-Gradle init script `apps/mobile/scripts/android-classpath.init.gradle` and runs `node scripts/licences.mjs --classpath <file>`. It fails when a resolved artifact has no licence row in `scripts/licences.mjs` or when the list differs from the committed `apps/mobile/scripts/android-classpath.txt`, which the About screen's Android list is built from. Each licence row records the exact version whose POM and LICENSE were checked, so a new version of a known library fails like a new library (the message names it, with the version its row was checked at). Fix it by checking that version's POM, LICENSE and any NOTICE, then updating the row (or adding one for a new library); never by copying the list alone. On a failure the resolved file is uploaded as artifact `android-classpath`: once every row is checked, copy it over `apps/mobile/scripts/android-classpath.txt`, copy any new NOTICE to `scripts/licence-texts/notice-<hash>.txt`, run `node scripts/licences.mjs` in `apps/mobile` and commit it all in an app PR. Third-party native code linked into the `.so` files is not on this list (#904). PRs that change `apps/mobile/package-lock.json` or the licence tooling also run this workflow, so drift shows before a tag.

API URL and version (#684). Release builds need the API address, or sync, sign-in, AI and content refresh are off (`apps/mobile/src/sync/auth.ts` reads `EXPO_PUBLIC_API_URL` at bundle time). Set the repository variable `ANDROID_API_URL` (its own name: the web deploy reads `EXPO_PUBLIC_API_URL` per environment, so the two never share a value by accident) to `https://<API_HOST>/api/v1` (not a secret; Settings, Secrets and variables, Actions, Variables). On a `v*` tag the job fails if it is missing or not that shape (`infra/scripts/check-api-url.sh`, shared with the web deploy); manual and PR runs warn and continue. `infra/scripts/android-release-config.sh` also writes `android.versionCode` and `version` into the runner's `apps/mobile/app.json` before `expo prebuild` (nothing is committed, no change to the app lane): tag `vX.Y.Z` gives `X*1000000 + Y*1000 + Z` (`v1.2.3` is 1002003, below Google Play's 2100000000 limit; the same tag always gives the same code, and the code rises with every release because versions do). A tag that is not plain `vMAJOR.MINOR.PATCH` (for example `v1.2.3-rc1`), or `v0.0.0` (versionCode must be at least 1), fails; non-tag runs use the run number and are not meant for Google Play: never upload a non-tag AAB. `infra/scripts/test-android-release-config.sh` tests this on PRs touching the workflow or the script.

Error tracking and site links (#827). Optional variables of the `android-release` environment, all inert when unset: `EXPO_PUBLIC_SENTRY_DSN` (the `mobile` DSN; empty means the app sends nothing) and `EXPO_PUBLIC_SITE_URL` (https origin of the website; the app hides its privacy, terms and deletion links without it, #825; **required on `v*` tags**, the job fails without it because Play needs the privacy link, `infra/scripts/check-site-url.sh`). PR runs never get the DSN (the workflow blanks it). The workflow sets `EXPO_PUBLIC_SENTRY_ENVIRONMENT` itself (`production` on a `v*` tag, `staging` on manual and PR runs); the app reads it for `Sentry.init` (#826). All three reach only the Gradle step that bundles the JS, never `npm ci` or `expo prebuild`; `infra/scripts/test-release-env.sh` fails CI if one moves to another step or to job level. **Set the DSN only after the privacy page's crash-report section and the Play data-safety answers are published (#748)**: the DSN is baked into the build, so a build made earlier cannot be switched on later.

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

## Production deploy (#685)

`.github/workflows/production-deploy.yml` runs when a `v*` tag is pushed. Nothing runs until the owner has a production VM (a second stack: it needs ports 80 and 443 and its own `.env`, so it is not the staging VM) and sets the repository variable `PRODUCTION_DEPLOY_ENABLED` to `true`. Needed:

| What | Name | Where |
| --- | --- | --- |
| Variable | `PRODUCTION_DEPLOY_ENABLED` = `true` | repository variables |
| Variables | `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_USER`, `PRODUCTION_DIR` (checkout on the VM, for example `/opt/plateandbar`) | environment `production` |
| Secrets | `PRODUCTION_SSH_KEY` (private key of a deploy-only user in the `docker` group), `PRODUCTION_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`) | environment `production` |

Create the environment `production` yourself (Settings, Environments) with required reviewers (so every release waits for your approval) and deployment tags limited to `v*`; the job is bound to it, so the secrets are not reachable from any other workflow or branch. Also add a tag ruleset (Settings, Rules, Rulesets) that forbids updating or deleting `v*` tags. The job fails unless the tag is `vMAJOR.MINOR.PATCH` and its commit is on `main`. On the VM it fetches tags, checks out the exact commit the workflow verified (`github.sha`, not the tag, which could be moved while the run waits for approval), and runs that commit's `infra/staging/release.sh <tag> <sha>`, which refuses unless HEAD and the tag both are that commit, runs `backup.sh` (a failed backup stops the release before anything changes), then `deploy.sh` with `DEPLOY_TAG=<tag>`. `deploy.sh` is the same script as staging (no duplicated logic): builds `plateandbar-api:<tag>`, points `API_TAG` at it, `compose up -d`, polls the health URL through the local Caddy, and on failure restores the previous `API_TAG`, recreates the API and exits non-zero, which fails the workflow. The backup prefix comes from `BACKUP_S3_PREFIX` in the production `.env` (use `production`). The first start of a new VM is manual (`infra/RUNBOOK.md` section 1): `backup.sh` needs a running database. Rollback by hand is the previous image tag (`infra/RUNBOOK.md` section 4a). The checkout stays on a detached HEAD at the last released tag.

Release name for the API (#827): `docker-compose.yml` sets `SENTRY_RELEASE: plateandbar-api@${API_RELEASE:-${API_TAG}}` for the API container. `deploy.sh` writes `API_RELEASE` into `.env` next to `API_TAG` (also on rollback): the `v*` tag without its `v` on production (`plateandbar-api@1.2.3`, lining up with the app's `plate-and-bar@1.2.3+code`), the 12-character sha on staging. `.github/workflows/staging-config.yml` and `test-deploy.sh` check it. When rolling back by hand, edit `API_RELEASE` too (or delete its line to fall back to the tag verbatim). The API reads it as `sentry.release` through Spring's relaxed binding of the environment variable, which is the intended mechanism: no `release:` line is needed in the backend's `application.yml` (a `${SENTRY_RELEASE:}` placeholder there would bind an empty string where the variable is unset, instead of leaving the release unset). `SENTRY_DSN` and `SENTRY_ENVIRONMENT` stay in the VM `.env`; the production `.env` must have `SENTRY_ENVIRONMENT=production` when `SENTRY_DSN` is set, and `release.sh` refuses to release otherwise (`test-release.sh`). DSN only after the privacy page is live.

## Staging deploy (#411)

Nothing runs until the owner has a VM (`infra/RUNBOOK.md` section 1) and sets the repository variable `STAGING_DEPLOY_ENABLED` to `true`. Then every push to `main` that touches the backend, content, `packages/api/openapi.yaml` or staging files (and manual runs from `main`) deploys that commit. Needed:

| What | Name | Where |
| --- | --- | --- |
| Variable | `STAGING_DEPLOY_ENABLED` = `true` | repository variables |
| Variables | `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_DIR` (checkout on the VM, for example `/opt/plateandbar`) | environment `staging` |
| Secrets | `STAGING_SSH_KEY` (private key of a deploy-only user in the `docker` group), `STAGING_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`) | environment `staging`, deployment branches restricted to `main` |

The job runs `git fetch`, `git merge --ff-only <sha>` and `infra/staging/deploy.sh` on the VM. The script builds `plateandbar-api:<12-char sha>`, writes it to `API_TAG` in `.env`, runs `docker compose up -d` and polls `https://$API_HOST/api/v1/health` for up to 5 minutes (`HEALTH_TIMEOUT_SECONDS`). If `compose up` fails or it never turns healthy it restores the previous `API_TAG`, recreates the API and exits non-zero. The workflow does not re-run CI: branch protection on the PR is what gates the merge. Tagged production releases are a separate workflow (Production deploy).

## Web app deploy (#683)

The web build of `apps/mobile` is served by the same Caddy that fronts the API (decision delegated to the owner: open source, one VM, and the refresh cookie of #644 is `SameSite=Strict`, so the app must be on the same site as the API). `infra/caddy/Caddyfile.web` is the site block (host `WEB_HOST`, files from `/srv/web`); `infra/caddy/Caddyfile.stack` imports it together with `Caddyfile.api`, and the staging Compose file mounts `infra/caddy/` and runs the stack file. Nothing is served until `WEB_HOST` is set: unset, the block listens on plain HTTP on port 8081 inside the container, which Compose does not publish, and requests no certificate.

The Caddyfile sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (expo-sqlite on web needs `SharedArrayBuffer`), HSTS, `nosniff` and a referrer policy; `no-cache` for `index.html` and every other file; `public, max-age=31536000, immutable` for existing files under `/_expo/static/` and `/assets/` (content-hashed by Metro); and serves `index.html` for any other path that is not a file (single-page app); a missing file under `/_expo/static/` or `/assets/` is a 404. It also sends a Content-Security-Policy (#749): `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (wa-sqlite; the export has no inline script), `style-src 'self' 'unsafe-inline'` (the export's reset `<style>` and react-native-web styles), `img-src 'self' data: blob:` and `worker-src 'self' blob:` (needed on web: the photo capture path loads `blob:` URLs that expo-image-picker and expo-image-manipulator create, and wa-sqlite starts its worker from one; `data:` covers the base64 previews), `connect-src 'self'` plus `https://$API_HOST` and, when `WEB_SENTRY_ORIGIN` is set in the staging `.env` (the origin of `EXPO_PUBLIC_SENTRY_DSN`; leave empty without a DSN), that origin, and `object-src`, `base-uri`, `form-action` and `frame-ancestors` all closed. The e2e server sends the policy read from `_headers` and every e2e test fails on a CSP console message (checked in a scratch worktree: without `'wasm-unsafe-eval'` or `'unsafe-inline'` for styles the app fails to start or styles are blocked). In `_headers` (Cloudflare Pages cannot template) the API host is `api.example.com` and there is no error-tracking origin: edit it if you use Pages. COOP, COEP and the CSP are copied from `apps/mobile/public/_headers` (Cloudflare Pages format, ignored by Caddy); `infra/scripts/check-caddy-headers.sh` fails CI when a header there is missing from or differs in `Caddyfile.web`, as it does for the site. `infra/scripts/test-web-caddy.sh` starts the pinned Caddy image over a fixture export and asserts the headers, cache rules and SPA fallback on real responses (job `validate web Caddyfile`).

Nothing runs until the owner sets the repository variable `WEB_DEPLOY_ENABLED` to `true`. A push to `main` then deploys to environment `staging`, a `v*` tag to environment `production` (give it required reviewers; #685 uses the same environment), but only a `vMAJOR.MINOR.PATCH` tag whose commit is on `main`, the same rule as the production API deploy. The two deploys are separate workflows with no ordering between them: the web bundle can go live before or after the API of the same tag, so keep API changes additive (the contract rule). Each environment has its own concurrency group. Needed in each environment:

| What | Name |
| --- | --- |
| Variable | `EXPO_PUBLIC_API_URL`: define it in each environment, never as a repository variable (Android uses its own `ANDROID_API_URL`): `https://<API_HOST>/api/v1`, checked by `infra/scripts/check-api-url.sh` (https, host, `/api/v1`, no trailing slash) and baked into the bundle |
| Optional variables | `EXPO_PUBLIC_SENTRY_DSN` (empty or unset = the app sends nothing), `WEB_SENTRY_ORIGIN` (the DSN's origin; the job runs `check-sentry-origin.sh` and fails if a DSN has no origin), `EXPO_PUBLIC_SITE_URL` (https origin of the website, for the app's privacy links, #825; required in `production`). `check-sentry-origin.sh` requires `WEB_SENTRY_ORIGIN` to equal the DSN's `scheme://host[:port]`; Caddy reads its own copy from the VM `.env`, which is not checked. On a `v*` tag the workflow stamps the version (tag without the `v`) into the runner's `app.json` before `expo export`, so the web release is `plate-and-bar@X.Y.Z`. Passed only to the build step, never to `npm ci`; `EXPO_PUBLIC_SENTRY_ENVIRONMENT` is set by the workflow (`production` on a `v*` tag, `staging` otherwise) |
| Variables | `WEB_SSH_HOST`, `WEB_SSH_USER`, `WEB_ROOT` (the VM directory that Compose mounts at `/srv/web`, a directory under `/srv`, `/var/www` or `/opt`, for example `/opt/plateandbar/infra/staging/web`) |
| Secrets | `WEB_SSH_KEY` (private key of a user that can write only `WEB_ROOT`), `WEB_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`) |

The job fails before building if the API URL or a variable is missing or malformed (user, host and root are checked for plain characters; the root must be a plain absolute path without `.` or `..` segments, checked by `infra/scripts/check-web-root.sh`). It runs `rsync` twice over the same SSH pattern as the site deploy: first everything except `index.html`, then everything with `--delete-after`, so new hashed files exist before a page refers to them. On the API set `CORS_ALLOWED_ORIGINS` and `AUTH_COOKIE_ORIGINS` to `https://<WEB_HOST>` (RUNBOOK.md section 7). Merges to `main` rebuild the web app whatever they touch (GitHub does not reliably combine `tags` with `paths` filters).
