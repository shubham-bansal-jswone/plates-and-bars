# Infra

CI and security automation for Plate & Bar. Owned by the Infra lane (`infra/`, `.github/workflows/`). Staging VM, Compose, backups and deploys come later (#36).

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, push to `main` | `changes` job decides which jobs apply; `api`, `core`, `mobile`, `backend` run only when relevant |
| `.github/workflows/lane-check.yml` | PR | Warns (never fails) when a PR touches more than one lane in the `docs/AGENTS.md` Lanes table |
| `.github/workflows/security.yml` | PR, push to `main`, weekly | gitleaks secret scan, dependency review (PRs) |
| `.github/dependabot.yml` | weekly | Updates for GitHub Actions, `packages/api`, `packages/core` (npm) and `backend` (gradle) |

Why one `ci.yml` instead of a workflow per folder with `on.paths`: a path-filtered workflow that does not trigger never reports, so a required check would stay "pending" forever. Instead, `infra/scripts/detect-changes.sh` does the path filtering and non-applicable jobs are skipped, which branch protection treats as passing.

On PRs both scripts diff `HEAD^1` against `HEAD`: CI checks out the tested merge commit, whose first parent is the current tip of the base branch, so a base that moved after the PR was opened does not add unrelated files. If the rev does not resolve, `detect-changes.sh` runs every job and `lane-check.sh` skips with a notice. Locally pass any rev, e.g. `origin/main`.

A job runs when (a) its folder contains the build file below and (b) the PR touched the folder or something it depends on (or `ci.yml` / `infra/scripts/`). Pushes to `main` run every job whose folder exists. Until a folder has its build file the job is skipped.

## What each lane must provide

CI runs exactly these commands from the folder. Match them; do not expect other commands.

| Folder | Detected by | Commands | Also runs when |
| --- | --- | --- | --- |
| `packages/api` | `package.json` | `npm ci`, `npm run check` (lint, generate, stale diff, typecheck), untracked-files check on `client/`; plus `npm audit --audit-level=high --omit=dev` as the separate `npm audit (api)` job | |
| `packages/core` | `package.json` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | `packages/api`, `docs/spec/golden/` or `docs/prototype/` changes |
| `apps/mobile` | `package.json` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | `packages/core` or `packages/api` changes |
| `backend` | `build.gradle` or `build.gradle.kts` | `./gradlew build --no-daemon` (JDK 21 Temurin; Docker is available for Testcontainers) | `packages/api/openapi.yaml` changes |

Requirements for the TS packages: Node 22 LTS, a committed `package-lock.json` (needed by `npm ci` and the npm cache), and the scripts `lint`, `typecheck`, `test` in `package.json`. For `backend`: a committed Gradle wrapper (`gradlew`, executable) and tests wired into `build`. If the lane needs different commands or a Node/JDK version, change them via an Infra issue.

### Stale generated client

`npm run check` in the `api` job regenerates `packages/api/client/schema.d.ts` from `openapi.yaml` and fails with an explicit message if that changes the tracked file or leaves untracked files in `client/`. Fix: run `npm run generate` in `packages/api` and commit.

### Lane check

`infra/scripts/lane-check.sh` parses the Lanes table in `docs/AGENTS.md` (the backticked paths in the "Owns" column), maps each changed file to its lane and emits a `::warning::` annotation if more than one lane is touched. Files outside every lane (root files, `docs/` outside `docs/adr/`) are ignored. Contract PRs (`packages/api` plus `docs/adr`) are one lane in the table, so they pass without a warning. If the table format changes, the script fails loudly rather than silently passing.

### Secret and dependency scanning

- gitleaks (v8.30.1, binary downloaded and verified against a SHA-256 hard-coded in the workflow, no licence needed) scans full history on every PR and push, plus weekly, with the root `.gitleaks.toml`. That file allowlists only the `jwt` rule, only for `packages/api/openapi.yaml` and `packages/api/client/schema.d.ts`, because the contract's examples contain deliberately fake JWTs (`id_token`, access tokens). It is path-based, not fingerprint-based, so changing the examples needs no update; a second entry allowlists `generic-api-key` in the same files only on lines naming `access_token`, `refresh_token` or `id_token` (the same fake examples). Every other rule, and `generic-api-key` on other lines, stays active.
- `dependency-review-action` fails PRs that add dependencies with known high-severity advisories (free on public repos; checked 2026-10-08 that this repo is public).
- Dependabot covers GitHub Actions, `packages/api`, `packages/core` and `backend`, and ignores `typescript` semver-major in the two npm packages and `gradle/actions` semver-major (see Pin). Infra adds the `npm` entry for `apps/mobile` in `.github/dependabot.yml` when it lands (other lanes do not edit it), because Dependabot errors on directories that do not exist yet.
- Recommended, a setting rather than code: enable Secret scanning and Push protection under Settings, Code security.

## Branch protection for `main` (to be set by Shubham)

Settings, Branches, rule for `main`: require a pull request, require status checks to pass, require branches to be up to date. Required checks (names as shown in the checks list):

- `changes`
- `api (lint, types, stale client)`
- `core (lint, types, tests)`
- `mobile (lint, types, tests)`
- `backend (gradle build)`
- `gitleaks`
- `dependency-review`
- `npm audit (api)`

Do not require `lane-check (warns only)`; it only annotates. Skipped jobs (folder absent or untouched) count as passing, so requiring all of the above is safe now. Note that `dependency-review` only runs on PRs, so it will not report on pushes to `main`; that is fine for PR-based protection.

Pins: `gradle/actions/setup-gradle` is pinned to the full commit SHA of v6.4.0 with `cache-provider: basic`; other actions use major version tags. Dependabot proposes bumps, except `gradle/actions` majors (ignored, so a human re-checks the licence). gitleaks is pinned by version and a hard-coded SHA-256 in `security.yml`.

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
