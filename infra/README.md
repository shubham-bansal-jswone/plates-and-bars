# Infra

CI and security automation for Plate & Bar. Owned by the Infra lane (`infra/`, `.github/workflows/`). Staging VM, Compose, backups and deploys come later (#36).

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR, push to `main` | `changes` job decides which jobs apply; `api`, `core`, `mobile`, `backend` run only when relevant |
| `.github/workflows/lane-check.yml` | PR | Warns (never fails) when a PR touches more than one lane in the `docs/AGENTS.md` Lanes table |
| `.github/workflows/security.yml` | PR, push to `main`, weekly | gitleaks secret scan, dependency review (PRs), `npm audit` for `packages/api` |
| `.github/dependabot.yml` | weekly | Updates for GitHub Actions and `packages/api` |

Why one `ci.yml` instead of a workflow per folder with `on.paths`: a path-filtered workflow that does not trigger never reports, so a required check would stay "pending" forever. Instead, `infra/scripts/detect-changes.sh` does the path filtering and non-applicable jobs are skipped, which branch protection treats as passing.

A job runs when (a) its folder contains the build file below and (b) the PR touched the folder or something it depends on (or `ci.yml` / `infra/scripts/`). Pushes to `main` run every job whose folder exists. Until a folder has its build file the job is skipped.

## What each lane must provide

CI runs exactly these commands from the folder. Match them; do not expect other commands.

| Folder | Detected by | Commands | Also runs when |
| --- | --- | --- | --- |
| `packages/api` | `package.json` | `npm ci`, `npm run lint`, `npm run generate`, stale-client check (below), `npm run typecheck` | |
| `packages/core` | `package.json` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | `packages/api` changes |
| `apps/mobile` | `package.json` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | `packages/core` or `packages/api` changes |
| `backend` | `build.gradle` or `build.gradle.kts` | `./gradlew build --no-daemon` (JDK 21 Temurin; Docker is available for Testcontainers) | `packages/api/openapi.yaml` changes |

Requirements for the TS packages: Node 20, a committed `package-lock.json` (needed by `npm ci` and the npm cache), and the scripts `lint`, `typecheck`, `test` in `package.json`. For `backend`: a committed Gradle wrapper (`gradlew`, executable) and tests wired into `build`. If the lane needs different commands or a Node/JDK version, change them via an Infra issue.

### Stale generated client

The `api` job regenerates `packages/api/client/schema.d.ts` from `openapi.yaml` and fails with an explicit message if that changes the tracked file or leaves untracked files in `client/`. Fix: run `npm run generate` in `packages/api` and commit.

### Lane check

`infra/scripts/lane-check.sh` parses the Lanes table in `docs/AGENTS.md` (the backticked paths in the "Owns" column), maps each changed file to its lane and emits a `::warning::` annotation if more than one lane is touched. Files outside every lane (root files, `docs/` outside `docs/adr/`) are ignored. Contract PRs (`packages/api` plus `docs/adr`) are one lane in the table, so they pass without a warning. If the table format changes, the script fails loudly rather than silently passing.

### Secret and dependency scanning

- gitleaks (v8.30.1, binary downloaded and checksum-verified, no licence needed) scans full history on every PR and push, plus weekly, with the root `.gitleaks.toml`. That file allowlists only the `jwt` rule, only for `packages/api/openapi.yaml` and `packages/api/client/schema.d.ts`, because the contract's examples contain deliberately fake JWTs (`id_token`, access tokens). It is path-based, not fingerprint-based, so changing the examples needs no update; a second entry allowlists `generic-api-key` in the same files only on lines naming `access_token`, `refresh_token` or `id_token` (the same fake examples). Every other rule, and `generic-api-key` on other lines, stays active.
- `dependency-review-action` fails PRs that add dependencies with known high-severity advisories (free on public repos; checked 2026-10-08 that this repo is public).
- Dependabot covers GitHub Actions and `packages/api`. Whoever creates `packages/core`, `apps/mobile` or `backend/` should ask Infra (or add, since it is a one-block change) the matching `npm` / `gradle` entry in `.github/dependabot.yml`, because Dependabot errors on directories that do not exist yet.
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

Pin: actions are referenced by major version tag; Dependabot proposes bumps.

## Local checks

```
actionlint
yamllint -d '{extends: relaxed, rules: {line-length: disable}}' .github
shellcheck infra/scripts/*.sh
infra/scripts/lane-check.sh origin/main
infra/scripts/detect-changes.sh origin/main
```
