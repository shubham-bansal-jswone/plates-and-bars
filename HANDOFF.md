# Plate & Bar: handoff (updated 2026-10-16, later)

Untracked on purpose (the owner keeps AGENTS.md, CLAUDE.md, .claude/skills and this file out of git). Read this first, then `docs/AGENTS.md` (lane rules), `docs/development-plan.md` (v1 scope) and `PROTOTYPE_SPEC.md`.

## Goal

Finish the full v1 from `docs/development-plan.md`: Expo app (web + Android), Astro website, Spring Boot backend, shared contract and core rules. Keep going until the app and website are complete; collect anything that needs the owner's accounts, money, keys or legal review instead of stalling.

## Repo map

- `packages/api`: OpenAPI 3.1 contract (currently 0.1.9), generated client, test vectors, guards. Contract changes come first and are additive.
- `packages/core`: pure TypeScript rule ports with golden and differential tests against `docs/prototype/plate-and-bar.html`. No regex lookbehind (guard test).
- `apps/mobile`: Expo SDK 57, expo-router, expo-sqlite (wa-sqlite on web), sync client, content store.
- `apps/site`: Astro website, privacy, terms, deletion page.
- `backend/`: Spring Boot, Java 21, Gradle, MySQL, Flyway (V1 to V6), JWT, Bucket4j.
- `content/`: bundled JSON content. `tools/`: importers and validators (`tools/validate/*` is the spec the app validators mirror).
- `tests/e2e`: Playwright suite (Chromium via `npm run install:chromium`, `CHROME_PATH`, `EXPO_NO_TELEMETRY=1`).
- `infra/`, `.github/`: CI, Caddy templates, staging compose, release workflows.
- Lane agents (Claude Code format): `.claude/agents/{app,backend,content,contract,core,infra,qa,reviewer,website}.md`. Reviewer is read-only.

## Standing policies (from the owner; follow exactly)

- Merge agent PRs when the reviewer verdict is Approve (or Approve with nits after the nits are applied) AND CI is green. No per-PR question to the owner.
- Open source only: nothing proprietary, no vendor terms of use. Check the licence before adding any dependency, action or image. MPL-2.0 (axe-core) was accepted as open source.
- Spec questions: decide per the author's recommendation, label `decided`, comment on the issue, keep working.
- Never force-push or rewrite history. Use merge commits and revert commits.
- No `Co-Authored-By` trailer and no "Generated with Claude Code" line in commits or PR bodies.
- Tests are mandatory; bug fixes ship a regression test that fails before the fix. Verify before claiming done.
- Security: secrets only via env; never log food, weight, health answers or tokens; all AI features stay off until the owner picks a provider and budget.
- Run the GitNexus impact check before editing a symbol and `detect_changes` before committing (`node .gitnexus/run.cjs ...`; the index is stale, re-run `analyze --index-only`).

## Workflow that worked

1. Open a GitHub issue first (labelled by lane), then a fresh worktree: `git fetch origin && git worktree add ../wt-<name> -b <lane>/<name> origin/main`.
2. One lane per PR, under about 400 changed lines where possible (split otherwise).
3. Before every push, from `apps/mobile`, one at a time: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npx expo export --platform web`, `node scripts/web-reload.mjs`. Backend: `./gradlew build` (integration tests need Docker). Core and api have their own suites.
4. PR body from a uniquely named file with the template checklist, explicit PR number, verify the body after creating it. `Closes #n` only when the issue is fully done, otherwise `Refs`.
5. An independent reviewer runs the checks in a throwaway worktree, mutates the code to prove tests fail, and posts one verdict comment. Reviewers were consistently right: they found real bugs in nearly every PR.
6. Apply nits, re-review if there were blockers, then merge with `gh pr merge N --squash --delete-branch`.
7. Merge gate: all status checks SUCCESS, SKIPPED or CANCELLED, and `mergeable` is not CONFLICTING.

## Hard-won rules

- Retarget a stacked PR to main BEFORE merging its base. A deleted base auto-closes the child and it cannot be reopened (this cost PR #339, replaced by #343).
- Never run e2e or `expo prebuild` inside a PR worktree (generated files bloated #375). Use a separate scratch worktree and check `git status` before every commit.
- When main moved after a squash, merge origin/main into the branch (keep both sides) and have the reviewer diff the result against main to prove nothing was lost.
- GitHub merge calls can return 504 but still merge: check the PR state before retrying.
- Validators for server-fetched content must mirror `tools/validate/*`, require every shipped name to stay present (additions and edits allowed), reject prototype-pollution names, and use own-property lookups.
- Check app limits against contract bounds: the backend validates against `packages/api/openapi.yaml` directly.
- Content migration pattern: see `apps/mobile/src/content/README.md`.
- Auto mode blocks `gh pr merge` ("Merge Without Review") and a reviewer launched on a commit you just pushed ("Self-Approval"). The owner added an allow rule for `Bash(gh pr merge:*)` via `/permissions`; chat approval alone does not lift it, and editing settings yourself is blocked too.
- GitNexus `impact`/`detect-changes` read the index of the main checkout, not a worktree: run impact from the main checkout before editing; `detect-changes --repo .` inside a worktree fails ("Repository not found").
- Local backend tests: the Gradle 9.8.1 wrapper download times out on this network. Point `gradle-wrapper.properties` at the cached 9.8.0 (drop `distributionSha256Sum`) for the run only, restore it before committing; CI uses 9.8.1. Docker is often down locally, so the `*IT` tests run only in CI; run unit tests with `./gradlew test --tests '*Test'`.
- Library upgrades that touch a trust boundary: pin behaviour with golden tests in a first commit on the old version, then migrate (#417 is the pattern).
- Gradle wrapper bumps (#422): `distributionSha256Sum` is pinned; if a Dependabot wrapper PR does not update it, the backend job fails with a checksum mismatch: set it from the official `.sha256` file in that PR.
- Dependabot majors that cannot land yet: comment `@dependabot ignore this major version` with the reason and a tracking issue.
- Lane scope is enforced on the `edit`/`write` tool only. The shell tool can still write anywhere (redirection), so the lane globs are a guardrail, not a sandbox: instruct lane agents to edit with the edit tool, and confirm a scope probe (in-lane write ALLOWED, out-of-lane DENIED) with a fresh agent after changing a glob.

## State at pause

Merged in the last stretch (all through the reviewer gate): theme, contract 0.1.7 to 0.1.9, content bundles end to end (backend endpoints, refresher, all readers on the validated store), AI app features (off by default, consent-gated), exercise library and About, privacy and deletion pages (draft with placeholders), Playwright E2E, accessibility fixes (headings, aria state), the backend security pass, Android backup off, single-flight token refresh, size-aware sync batching, core length checks, Android release and site deploy workflows (inert until secrets and variables exist), site CI.

Merged on 2026-10-12/13 (all through the reviewer gate, CI green on main): #403 Caddy API template (body limit 4 MiB, above the backend's 2 MiB), #407 staging Compose + backup script (stub-docker test) + runbook, #402 CI detect-changes + content-meta check (shallow-only by decision), #404 Workout stale write, #405 rapid-loss card, #406 reload after sync, #413 start over a pulled tombstone (closes #408; also covers leftover sets, rules on Targets and the can't-do sheet), #414 syncLift builds on stored lift records (closes #409), #415 workout writes three-way merge a change stored elsewhere (closes #410).

Also merged on 2026-10-13: #417 json-schema-validator 1.5.9 -> 2.0.8 (golden tests pin sync and AI error details; the only change is that `pattern` `$` no longer matches before a trailing newline), #422 Gradle wrapper checksum, and Dependabot #383, #384 (Gradle 9.8.1, three high advisories), #386, #387, #389 (js-yaml 5), #390. Main CI green.

Dependabot: closed with `@dependabot ignore this major version`: #318 (json-schema-validator 3.x, needs Jackson 3; #416 stays open for it) and #320 (TypeScript 7: `@astrojs/check` does not accept it yet). Expo-managed bumps (#319, #322, #385, #388) wait for the SDK upgrade (#113, #58).

Also merged on 2026-10-13/14: #423 + #424 (closes #418: contract 0.1.10 quotes Reminder `'on'`; verify.mjs guard rejects unquoted YAML 1.1 booleans/octals as keys, flow or block items, or plain values; backend test pushes a reminder), #425 (closes #419: sync error paths are cut where they enter an open map, computed from the validator's evaluation path, and only `required` appends a property, so no client-chosen key is echoed), #426 (closes #420: a body with a number too large for a double, 1e400 or a 400-digit integer, is treated as unparseable in SyncController and AiController via `common/FiniteNumbers`).

Also merged: #427 + #428 (closes #412: content-meta checks dates on a shallow clone), #430 (closes #251: encrypted on-device photo vault, AES-256-GCM via expo-crypto, key in secure-store; wipe marker `device.photos_wipe_pending` written in the store-wipe transaction, `finishPhotoWipe` pays it at sign-in, launch and before any photo read/write), #431 (closes #429: progress photos on the Progress tab; capture via expo-image-picker + expo-image-manipulator, both MIT; cache copies deleted; guard announces wipes only after the marker is cleared; storage permissions blocked).

Also merged (2026-10-14): #432 (closes #303: stored 0 steps and 0 h sleep pre-fill as 0), #433 + #436 (close #334, #434: planned-meal log names skipped foods; plan line marks items no longer in the food list and hides Log it when nothing can be logged; Food toasts stay longer for long messages), #435 (closes #401: SyncResult.pushed; a refused sync after pushes/pulls or set-asides gets its own message; counts kept on every rejected path).

Merged on 2026-10-15 (reviewer gate + CI green; HANDOFF updated after each merge):
- #465 kitchen-test comparison, Copy all as a table, Targets entry (part of #284). Kitchen tests sits last on Targets; when Water sizes / My foods sections land it goes just before My foods (prototype order).
- #458 Make it fit on the recipe builder (part of #284). Two-fatty-row screen test skipped by reviewer agreement (core covers applyFit).
- #467 refresh single-flight tracks every (owner, token) pair; joiner gets `unavailable` (closes #400). Keyed by owner by decision (owner change always brings a new token pair). #473 (flaky "refreshes are single-flight") not reproduced in 14+3 loaded runs; likely the fixed 10 ms `settle()`; evidence on the issue, left open.
- #477 Dependabot @swc/core 1.16.18 (Apache-2.0, reviewer approved).
- #481 thread-safe log capture in four ITs (closes #466). Merged with an explicit clean squash message because the first commit carried an attribution trailer: pass `--subject/--body` when a branch commit has one.
- #474 fresh Settings takes core's DEFAULT_WATER_SIZES (refs #158).
- #478 contract test-vectors check bounds on AI request bodies (closes #469); the AI schema list is derived from the `/ai/*` request-body refs.
- #463 body map and AI tag suggestion on the custom exercise sheet (part of #312). MIT notice for the body-map polygons ships via a `/*!` comment and on About. Needs backend #479 for the server to offer `suggest_tags`. Site PR #471 (privacy line for Suggest muscles) can now merge.
- #480 can't-do pick by name skips blank sets when another device added it (closes #459). Follow-ups filed: #491 (concurrent same-name picks double), #492 (addExercise row + sets in one transaction). Clean squash message used (branch had attribution lines).
- #479 backend POST /ai/suggest-tags (closes #464): flag `AI_SUGGEST_TAGS_ENABLED` default off, shared quota/rate limit, reply repaired to the contract (enums read from the contract via AiSchemas), name never logged. Also fixed a leak: AiEndpointsIT left `ai_spend_monthly` full for the next IT class. The 400 detail for a name blank after sanitising follows #421 once decided.
- #451 contract 0.1.12: refresh grace window (part of #399). A rotated token re-presented < 60 s after its FIRST rotation, while its successor was never presented to /auth/refresh, rotates (marks replaced) that successor and issues a new pair; presenting a replaced token is reuse and ends the session. Window never extends. `/auth/refresh` also gains 503 `unavailable` (lock conflict after one server retry; token unchanged, retry shortly). ADR 003 amended.
- #472 backend refresh grace window per #451 (closes #399): replaced successors tracked (`replaced_at`), window from first rotation, refresh transaction retried once on a lock conflict then 503 `unavailable`. AuthServiceRefreshTest + AuthFlowIT cover it.
- #499 core `reentryCard`/`reentryRange` ("Welcome back" after 14+ days off) and `steadyCard` (6+ steady weeks), differential-tested against the prototype's renderStart (part of #486). App card for them still to do (after #495).
- #497 Workout "where" chips (closes #484). Override held in local state until Start (accepted: no workout row before Start), stored as `Workout.where`; picking the profile's own place stores null; StartView keyed by date; second session follows the day's where.
- #498 core `waterSizeEntry` (round, keep 50–3000 ml) with WATER_SIZE_MIN_ML/MAX_ML, differential-tested against the prototype data-wt line (part of #482). #493 (app Water sizes + My foods) next: merge main into it, then merge.
- #471 site privacy page lists what Suggest muscles sends (closes #470). Optional follow-up: #463's in-app `consentSent` copy could match the page's wording.

#270 (flaky workout test): not reproducible in 27 runs incl. heavy CPU load; no CI record. Leading hypothesis and candidate fix (asyncUtilTimeout 5000 via a jest setup file) on the issue; not applied without a reproduction.

Merged on 2026-10-16: #493 Water sizes and My foods on Targets (closes #482); #501 core `weekSummary` (part of #489); #475 Dependabot @redocly/cli 2.62.1.

Tooling: OpenCode lane subagents live in `.opencode/agents/` (generated from `.claude/agents/*.md` by `.opencode/generate-agents.mjs`, tracked; regenerate after editing a `.claude` agent). Lane edit scope is `deny *` then `allow <lane>/**` **and** `allow **/<lane>/**` — the second glob matches absolute paths into a sibling git worktree (the permission matcher is unanchored), so a lane subagent can work inside `../wt-*` while out-of-lane writes stay denied.

Merged later on 2026-10-16 (reviewer gate + CI green): #494 copy-previous-day (after-await guard test + nits), #496 core targets-edit (nits: activity fallback pinned with `sitting`, `BurnToday.steps`), #502 Seven days on Progress (fill 0.85, strings in `copy.ts`, bar tests, target line `opacity:.5`; a11y label divergence filed as #503; dark-mode brand/track contrast filed as #504), #476 Dependabot expo-sharing 58.0.16 (its e2e failure was a Chromium-download flake), #495 recovery re-entry (blocker fixed: `rangesOf` pct gate and `isRange` date check; a falsy `from` is open-ended per the prototype `inRange`), #500 editable daily targets + burn-so-far (branch merged with main so the three-dot diff is app-only; the read-only tiles stay off Targets behind a test).

All eight 2026-10-16 PRs went through the reviewer gate; main CI green at `fcc73b3`. No open agent PRs. Waiting on the Expo SDK upgrade (#113, #58): Dependabot #319, #322, #385, #388.

Open issues filed this stretch, not started:
- #421 (needs decision): `\S` accepts text made only of non-breaking or zero-width spaces; pick one "blank" definition for contract, backend and app.
- #411 deploy staging on merge to main (needs VM and SSH key).
- #503 (spec-question): Seven-days bar aria-label has no day and announces "0 kcal, 0 g protein" on a blank day (the app keeps the day-aware label; prototype to follow).
- #504 (spec-question): dark-mode `brand`/`track` contrast is under DESIGN.md §11.1's 3:1 (Progress week bar at 0.85 = 2.08:1; the water bar draws the same pair).

Known gaps left on purpose (documented in the PRs): iOS photo vault needs backup exclusion and a this-device-only keychain item before iOS ships (#429 comment); the Workout "can't do" sheet still computes its change from the screen's list; a live workout pulled while the screen shows no session is still overwritten by `start()`; two offline devices picking the same can't-do name the same day double its sets (#491, accepted as a v1 gap, Remove last set recovers).

## Blocked on the owner

- Reminders: `expo-notifications` pulls Firebase on Android. Accept, write a small Android AlarmManager module, or defer (recommended: defer). Device steps (#300) need a Kotlin module.
- Per-account record cap (#353, #349): recommend 413 `account_full` plus a per-record outcome.
- Setup consent wording (#361): prototype text says data is "saved privately to your Claude account" and that photos go to Claude; must be rewritten before launch.
- Lab hold (#219) and cycle line (#258): the contract has no field (`labHold` not synced in v0, no cycle fields). Needs a spec decision.
- Manual email-deletion path on the deletion page has no owner or runbook.
- Accounts and decisions: domain and email/SMTP, hosting (GitHub Pages vs Caddy VM), AI provider and monthly budget, GlitchTip and Uptime Kuma (and the Kuma host), Play Console and the Android upload keystore (create the `android-release` GitHub environment restricted to `v*` and add four secrets), lawyer review of privacy, terms and deletion pages, coach or dietitian review, exercise photo and text provenance, repo licence and visibility (#76), required branch-protection checks (site a11y, e2e), backup retention (30 days decided) and export rate (20/h decided).

## Environment needed

`gh` authenticated; Node and npm; Java 21; Docker (backend integration tests, caddy validation); GitNexus CLI; Chromium via `npm run install:chromium` for e2e. No secrets live in the repo.

## Local previews

App: `npx -y serve@14.2.4 dist -l 8080 --single` in `apps/mobile` after `npx expo export --platform web` (serve.json sets COOP same-origin and COEP require-corp). Site: `npx astro preview` in `apps/site`.

## Two sessions (2026-10-16)

Claude Code and an OpenCode session work in parallel, split by issue. OpenCode owns #495 and #500 (and later took #486, the continuation of #495, and #524, the core piece of #488, which was unclaimed). Claude Code owns #488 (Why it works cards, `../wt-why`, branch app/why-cards), #485 (feel check: contract `../wt-feel-contract` branch contract/workout-feel, then app), #490, #491, #492. Re-read this file before every merge.

Merged by Claude Code on 2026-10-16:
- #509 site: privacy and deletion pages say withdrawing consent means deleting the account (part of #490; app side is #507).
- #507 app: withdrawing consent means deleting the account, on Your data, the delete confirmation, setup consent and About (closes #490). CONSENT_TEXT_VERSION 2026-10-16 applies to new consent records only; existing users are not re-asked. Follow-up #515 (Skip-for-now users can't reach Your data) is PR #518.
- #491 closed as an accepted v1 gap (see Known gaps).
- #510 contract 0.1.13: one "blank" rule (Unicode White_Space + U+200B–U+200D, U+2060, U+FEFF) for must-not-be-blank text (#421 decided). Explicit char class, no \s/\S/\v/\h/\R/\p or lookbehind anywhere in the spec (verify.mjs guards). Follow-ups: #512 backend, #513 app (in progress), #514 tools. Feel contract #505 must now bump to 0.1.14.
- #508 app: addExercise writes the exercise row and its sets in one transaction (closes #492). lockedDb gained withExclusiveTransactionAsync via syncDb(rawDb) so inTransaction works on web (it threw "not supported on web" before). Follow-ups: #516 (start/addSecond/removeExercise/persistCant same gap), #517 (photo wipe on web test).
- #518 app: Your data reachable from Targets without a profile (closes #515). Follow-up #519 (About reachable without a profile; Skip for now not kept across reloads).
- #528 app: About and sources reachable without a profile (closes #519). Skip for now stays in memory, matching the prototype (su-skip saves nothing; reload with no profile returns to setup). Minor difference left: the prototype also skips setup on reload when any settings are saved; the app's gate checks only the profile.
- #505 contract 0.1.14: optional nullable `WorkoutExercise.feel` (`target`, `pain` or a card `w` index) for the feel check (part of #485). Backend round-trips it with no code. Follow-up #527: the app's exerciseRecord drops unknown exercise keys. Core rules PR #529 and app PR #511 still in review.
- #525 backend: AiPrompts.isBlank applies the #421 rule after sanitising (U+202E + NBSP now 400 `pattern`, provider and quota untouched); BlankTextVectorsTest runs the shared vectors; backend test task declares packages/api/test-vectors as an input (closes #512).
- #530 tools: one `nonEmpty` (tools/validate/text.mjs) with the #421 rule for cards, foods and recipes, tested against the shared vectors (closes #514). CI filter follow-up #531 in progress.
- #529 core feel-check rules (priorSessions, isLearning, showFeel, feelResult), differential-tested against prototype feelHtml (part of #485).
- #532 infra: tools CI job runs when packages/api/test-vectors/ changes (closes #531).
- #511 app: feel check after a set in learn mode (closes #485). Pain note verbatim from the prototype with red border; Find an alternative opens can't-do with reason pain (joint scope); Skip remaining sets tombstones and renumbers.
- #506 app: Why it works cards and WhyLink on Targets, Progress and Workout (part of #488). Weak-source cards (#212: ramp, ladder, formfirst) hidden via HIDDEN_CARDS. Follow-ups #520 (library + daily read), #521 (split, workoutburn links), #522 (missing cards content), #523 (in-sheet question), #524 (core protein floor).

Merged by OpenCode on 2026-10-16 (later), reviewer gate + CI green:
- #524 core protein floor (`proteinFloor`, `PROTEIN_PER_KG` = `Math.round(w*1.6)` with `r1` only formatting the label), differential-tested against `KB.protein.b` (part of #488). Unclaimed when picked up, core-lane only; unblocks the protein WhyLink for the app follow-ups #520/#521.
- #535 Core protein floor helper (closes #524). Review nit applied: the differential test slices the prototype card by trimmed text (`sliceTrimmedLine`), so reformatting the HTML's indentation cannot break it.
- #536 App re-entry ("Welcome back": gap ≥ 14 days, 15%/30% → 7/14 days) and the optional steady-weeks card on the Workout start screen (closes #486), using core `reentryCard`/`reentryRange`/`steadyCard` and a new `startReentry` in `adjust.ts`. Review nits applied: the four card-action tests assert the stored adjustments exactly (a spurious decline or range write now fails; mutation-proved) and `RecoveryCards` → `StartCards`.
- Follow-up filed: #537 (adjustment cards mute silently; the prototype `adj-mute` toasts "Got it, no more of these").

Merged by OpenCode on 2026-10-16 (later still), Expo SDK 58 track:
- #44 Infra lane widened to `.github/**` and `.gitleaks.toml` (generator + `.claude/agents/infra.md` + `docs/AGENTS.md`, agents regenerated). Committed straight to `main` (`4bd4409`, tooling pattern) so the Infra lane can edit Dependabot config.
- #538 Infra: Dependabot ignores every Expo-managed package in `apps/mobile` (`expo*`, `@expo/*`, `react`, `react-dom`, `react-test-renderer`, `react-native*`, `jest-expo`, `eslint-config-expo`, `@types/react`, `@types/jest`) plus `eslint` semver-major (part of #113; squash `b12d248`). Merged as "part of" — but `gh --squash` appended the branch commit list, whose first commit still said `closes #113`, so #113 auto-closed; reopened it (the README half is #539).
- Consequence: Dependabot **closed #319, #322, #385, #388 by itself** ("no longer being updated"), so the four parked bumps are resolved by the policy, not by an SDK-version bump.
- #541 App: **Expo SDK 58 landed** (squash `b652e62`, closes #58). expo 58.0.13, expo-router 58.0.22, jest-expo 58.0.11, jest 30.5.2, react/react-dom 19.3.0, react-native 0.88.0, screens ~4.30.0, svg 15.16.0, safe-area ~5.10.1. Two decisions worth knowing: `expo.install.exclude: ["jest","@types/jest"]` (Expo's template pins jest 29, #58 wants 30) and `asyncRoutes: false` on the expo-router plugin (SDK 58 otherwise splits every route into a lazy web chunk, which breaks offline; the export is one bundle again). `decode-uri-component` cleared; the four remaining advisories are build/CLI tooling only. Review nits applied so `expo install --check` and `expo-doctor` (20/20) reproduce: the expo-router/log patch ranges now match `bundledNativeModules.json`.
- #543 App: README note that Expo-managed packages move with the SDK upgrade (squash `20912a3`, closes #113 and #539). Reviewer approved with nits: the bullet no longer claims `react-test-renderer` is a pinned *install* (it left the app in #541) — it is listed as Dependabot-ignored, so it can never drift from `react` if it returns, which keeps the note and `.github/dependabot.yml` in agreement. Its first CI run reddened the `e2e` job on the #542 flake despite being README-only, so it was held and merged only after that fix landed — no "retry for a lucky green", since the suite sets `retries: 0` on purpose.
- #544 QA: fixed the SDK 58 e2e a11y opener race (squash `48cafa6`, closes #542). The incoming tab mounts one commit after the outgoing one is `aria-hidden`, a ~10–26 ms window with **no** non-`aria-hidden` level-one heading. Three openers were satisfiable on the *previous* screen: `workout` (`[aria-label^="Start "]` matched Targets' "Start a rest timer after each set"; `/day$/` matched Targets' h1 "You burn about 2,493 kcal a day"), `about` (`/about/i` matched that same headline) and `targets` (no wait at all). They now wait on screen-unique markers (`[aria-label^="Exercise 1: "]`, exact `About and sources`, `Redo setup`), and `scan()`'s precondition is auto-retrying (`toPass`, 5 s) so a single read cannot land in the window while a screen that genuinely has no level-one heading still fails. Evidence: `--repeat-each=15` went **14/300 → 0/300**; the reviewer's independent revert measured 113/120 before vs 60/60 after; a probe confirmed `axe: workout` still axes Workout, so coverage held.

OpenCode watchpoints: `main` is moving fast, so merge `origin/main` before every push. The GitNexus runner and index live only in the main checkout, so confirm blast radius by text search inside a worktree. OpenCode worktrees `wt-reentry-cards`, `wt-protein-floor`, `wt-expo58`, `wt-dependabot`, `wt-a11y-opener` and `wt-readme-note` are removed; `../wt-*` worktrees for #526/#533/#517/#522/#534 belong to the Claude Code session — do not touch them. Main CI green at `20912a3`. The e2e `axe: workout` flake is fixed (#544), so a red there is a real regression again.
