# Plate & Bar — Development Plan

Oct 7, 2026 · @Shubham Bansal

Ship Plate & Bar as one React Native (Expo) codebase for Android, web and later iOS, on a Spring Boot + MySQL backend, Android-first, in about 6 months of part-time work.

The working prototype on claude.ai is the specification: every feature, rule and calculation there is the behaviour to reproduce, and its logic is ported, not reinvented. The product plan (Plate & Bar — Product Plan) holds the why; this doc holds the how.

## Principles and constraints

- **Offline first.** Gyms have poor signal. Everything is written on the phone first and synced later; nothing a user does is ever lost to a bad connection.
- **Contract first.** The API is written as an OpenAPI spec before any code, so backend, app and agents build in parallel against one agreement.
- **One source of truth for the rules.** Plan engine, progression, targets and food maths live in one tested shared package used by the app and checked by the backend.
- **Zero-cost stack** except what can't be avoided (store fees, a domain, Claude API usage), each listed in the budget.
- **Suggest and confirm, privacy by default, no medical advice**: carried over unchanged from the product plan.
- **Nothing merges without a human.** AI agents write code; Shubham reviews and merges every change.
- **Part-time reality.** Plan for about 10–12 hours a week alongside a full-time job; every milestone is sized to that.

## Scope: what ships in v1

v1 is everything in the prototype that works without risky data or heavy AI cost; the rest follows in v1.1 and v2.

| Area | v1 (Android + web) | v1.1 | v2 |
| --- | --- | --- | --- |
| Setup | Consent, health check, targets, plan engine | — | — |
| Training | Plans, weight guidance, ratings, rest timer, warm-ups, exercise cards with photos, exclusions, ladders, adjustments, second session | Live pose tracking | Video-to-3D animations |
| Food | Food list (USDA + own recipes), grams, Hindi names, recipes, meal ideas, plans, grocery list, hydration, fibre | Barcode scan (Open Food Facts) | Label scanning |
| AI features | Describe a meal, Ask why, weekly summary (cheap text calls, capped) | Meal photos, recipe import, form check | — |
| Progress | Weight, measurements, photos (on device), weekly check-in, real burn, habits | Cycle log | Lab reports (after medical and legal review) |
| Platform | Offline sync, export, delete, reminders, Health Connect steps | iOS app | Smartwatch |
| Website | Landing page, privacy policy, terms, account deletion page | Blog with science cards | — |

iOS waits for v1.1 because Apple’s developer account costs $99 a year; Android is a one-time $25.

## Tech decisions

React Native with Expo settles the open framework question: one TypeScript codebase covers Android, iOS and the web app, and the prototype's JavaScript logic ports straight into it.

| Layer | Choice | Why |
| --- | --- | --- |
| App (Android, iOS, web) | React Native + Expo SDK, TypeScript, Expo Router | One codebase for three platforms; reuses the prototype's logic; Expo builds without a Mac until iOS |
| On-device storage | expo-sqlite (records), expo-file-system (photos), expo-secure-store (tokens) | Offline first; private files stay on the phone |
| Shared logic | `packages/core` in TypeScript, unit-tested | Plan engine, progression, targets, food maths: one copy, tested once |
| Backend | Java 21, Spring Boot 3, Gradle | Your strongest stack |
| Database | MySQL 8 with Flyway migrations | Your strongest stack; versioned schema changes |
| Cache and rate limits | Redis (later; in-memory Bucket4j at first) | Not needed for v1 load |
| Auth | Google sign-in + email one-time code, JWT access + refresh tokens; Sign in with Apple added with iOS | Free; Apple requires its own sign-in when others are offered |
| Files | Cloudflare R2 (only for opt-in photo backup, exports) | 10 GB free, no egress fees |
| AI | Claude API, called only from the backend | Key never ships in the app; quotas enforced server-side |
| Website | Astro static site on Cloudflare Pages | Free, fast, no server |
| Hosting | Oracle Cloud Always Free ARM VM (Docker Compose: API + MySQL) | Free tier large enough for v1; move to managed MySQL when users grow |
| CI/CD | GitHub Actions; EAS Build free tier or local Gradle builds | Free at this scale |
| Monitoring | Sentry free tier (app + API), UptimeRobot | Errors and downtime alerts at no cost |
| App testing | Jest (core), Maestro (mobile end-to-end), Playwright (web) | All free |

## Architecture

The phone does the thinking and works without a connection; the server stores data, syncs devices, and is the only thing that talks to Claude.

&#91;embedded content: system architecture · device, server, services\]

The app writes every change to its local SQLite store first and syncs it through one `/sync` endpoint when online. The website is static except its account deletion page, which calls the API.

## Repository and data model

One private GitHub monorepo, so the API contract, shared logic and content change together in one pull request.

```
plate-and-bar/
  apps/mobile        Expo app (Android, iOS, web)
  apps/site          Astro website
  backend/           Spring Boot API (Gradle)
  packages/core      shared TypeScript rules: plan engine, progression, targets, food maths
  packages/api       OpenAPI spec + generated TypeScript client
  content/           exercises, cards, recipes, foods, science cards (JSON, reviewed in PRs)
  tools/             USDA import, kitchen-test import, content validators
  infra/             Docker Compose, backups, deploy scripts
  docs/              this plan, ADRs, AGENTS.md
```

**Core tables (MySQL)**, every user-owned row carrying `user_id`, `updated_at`, `deleted_at` and a `version` for sync:

| Table | Holds |
| --- | --- |
| `users`, `auth_identities`, `refresh_tokens` | Account, Google or email identity, sessions |
| `profiles`, `consents` | Setup answers, targets, health check, dated consent records (DPDP) |
| `food_logs`, `water_logs`, `day_notes` | Meals with per-serving macros, water, steps, sleep, “day complete” |
| `workouts`, `workout_sets` | Sessions, sets with weight, reps, rating, timestamp |
| `lift_stats` | Per-exercise history used for suggestions and stalls |
| `weights`, `measurements` | Body data |
| `user_foods`, `recipes`, `kitchen_tests` | Personal foods and weighed dishes |
| `exclusions`, `swaps`, `settings` | Training rules and preferences |
| `foods`, `food_aliases`, `food_sources` | Shared database with source and licence per row |
| `exercises`, `exercise_tags` | Library, synced from `content/` |
| `ai_usage` | Per-user daily AI calls for quotas and cost |

Progress photos, cycle data and lab results are never stored on the server in v1.

## API and AI cost control

The API stays small: auth, one sync endpoint, food search, content, AI and account rights. All rules run on the phone; the server stores, syncs and guards.

| Endpoint group | Purpose |
| --- | --- |
| `POST /auth/google`, `/auth/email/start`, `/auth/email/verify`, `/auth/refresh` | Sign in, tokens |
| `POST /sync` | Push local changes since the last cursor, pull server changes; returns a new cursor |
| `GET /foods?q=` | Search by name or alias; paged |
| `GET /content/manifest`, `/content/{bundle}` | Versioned exercise, card, recipe and food bundles |
| `POST /ai/describe-meal`, `/ai/ask-why`, `/ai/weekly-summary` | v1 AI calls |
| `POST /ai/meal-photo`, `/ai/import-recipe`, `/ai/form-check` | v1.1 AI calls |
| `GET /me/export`, `DELETE /me` | Download and delete everything |

**Sync rules.** Each record has a client-made UUID, `version` and `updated_at`. The server accepts a change only on the expected version; on conflict the newer edit wins per record and the other is kept in a conflict log. Deletes are soft (tombstones) so they reach every device.

**AI cost control**, because Claude API calls are the one cost that grows with users:

- Every AI call goes through the backend, which strips photo location data, checks the user’s daily quota and logs usage.
- Default quotas: 10 text calls a day per user; photo features off until a monthly budget is set.
- Cheapest model that does the job (a small model for text, a vision model only for photos); identical questions cached.
- One server flag turns any AI feature off instantly; a monthly spend alert at 80% of budget.
- Every AI feature has a non-AI fallback (food list, custom entry, cards), so the app still works with AI off.

## Building with parallel AI agents

Agents work in parallel only where folders and contracts keep them apart; you are the architect, reviewer and only merger.

| Agent | Owns | Never touches |
| --- | --- | --- |
| Contract | `packages/api` (OpenAPI spec), ADRs | Implementation code |
| Core logic | `packages/core`: ports prototype rules with tests | UI, backend |
| Backend | `backend/`: endpoints, migrations, sync, AI proxy | App, content |
| App | `apps/mobile`: screens, offline store, sync client | Backend, rules (imports `core`) |
| Content | `content/`, `tools/`: exercises, cards, recipes, USDA import | Code outside `tools/` |
| Website | `apps/site` | Everything else |
| QA | Maestro and Playwright tests, bug reports | Fixes (files issues instead) |

**How a piece of work flows**

1. You write a GitHub issue with acceptance criteria, linking the prototype behaviour it reproduces.
2. Contract changes land first, alone, after your review.
3. Agents work on their own branch, in their own folder, against the merged contract.
4. Each pull request is small (under about 400 lines), passes CI, includes tests, and fills the PR checklist.
5. You review and merge; the QA agent runs end-to-end tests on the merged result.

**Rules every agent follows**, kept in `docs/AGENTS.md`:

- Read the issue, the contract and the prototype behaviour before writing code.
- Never commit secrets, change another agent’s folder, or edit the contract outside a contract PR.
- Rules and numbers come from `packages/core` or `content/`, never re-typed in UI or backend code.
- Every new calculation gets a test with numbers checked against the prototype.
- Unsure → ask in the issue; don’t guess.

## Quality: tests, CI/CD, monitoring

A change reaches users only after automated tests, your review and a staging check; the riskiest code (rules and sync) gets the most tests.

| Test layer | Covers | Tool | Gate |
| --- | --- | --- | --- |
| Golden numbers | Targets, burn, meal ideas, progression, fibre: fixed inputs checked against prototype outputs | Jest | Every PR |
| Core unit | All of `packages/core` | Jest | 90% line coverage |
| Backend | Endpoints, sync conflicts, quotas, migrations on real MySQL | JUnit + Testcontainers | Every PR |
| Contract | API matches the OpenAPI spec | Spring REST Docs or Schemathesis | Every PR |
| End to end | Setup, log a meal, log a workout, offline then sync, export, delete | Maestro (Android), Playwright (web) | Before each release |
| Devices | A low-end Android phone (2–3 GB RAM), a mid-range phone, Chrome on desktop | Manual checklist | Before each release |
| Accessibility | Screen reader labels, contrast, text size | Manual + axe | Before each release |

**Pipeline.** Pull request → lint, types, all tests → merge to `main` → deploy to staging automatically → you test on staging → tag a release → production API deploy (with a database backup first) → app build to Play internal testing → staged rollout 10% → 50% → 100%.

**Monitoring and recovery.**

- Sentry for crashes and errors in the app and API; UptimeRobot pings the API every 5 minutes.
- MySQL backed up nightly to R2, kept 30 days; a restore is rehearsed once a month.
- Every release can be rolled back: previous Docker image for the API, halted rollout for the app.
- Logs never contain food, weight, health answers or tokens.

## Security, privacy and compliance

The app handles health data, so the launch checklist below is a gate, not a wish list: v1 doesn’t go public until every box is ticked.

**Security (OWASP Mobile Application Security, level 1)**

- HTTPS only; tokens in the phone’s secure storage; short-lived access tokens with refresh rotation.
- Server secrets (database, Claude key) in environment variables on the server, never in the repo or the app.
- Input validation on every endpoint; rate limits per user and per IP; dependency and secret scanning in CI.
- Database encrypted at rest; the private photo vault encrypted on the device.

**Launch checklist**

- [ ] Privacy policy and terms on the website, written for India’s DPDP Act 2023 (lawyer review)
- [ ] In-app consent with a stored, dated record; withdraw consent = delete account
- [ ] Account deletion in the app and on a web page (Google Play requires both)
- [ ] Play Console: Data safety form, health apps declaration, 18+ content rating
- [ ] Medical disclaimer in setup and the store listing; health check and doctor-clearance flow
- [ ] Coach review of exercise cards and plans; dietitian review of recipes, portions and food guidance
- [ ] Attribution screen: USDA FoodData Central, Open Food Facts (when added), Free Exercise DB, react-body-highlighter (MIT)
- [ ] No IFCT or INDB data anywhere in the app or database
- [ ] Security review of auth, sync and the AI proxy; a test that one user can never read another’s data
- [ ] Incident plan: who to notify and how, if data leaks (DPDP requires notice to the Data Protection Board and users)

## Milestones

Seven milestones take v1 from an empty repo to a public Android and web launch in about 26 weeks; no milestone starts until the previous gate passes.

&#91;embedded content: milestones M0–M6 · deliverables and exit gates\]

If a milestone runs late, cut from the bottom of the v1 scope rather than skipping a gate. iOS, meal-photo AI, barcode scanning and the cycle log follow as v1.1 after launch.

## Budget

v1 can launch for about $25 plus a domain if AI features stay capped; everything else runs on free tiers.

| Item | Cost | When |
| --- | --- | --- |
| Google Play developer account | $25, one time | Milestone 5 |
| Domain name | About ₹800–1,200 a year | Milestone 1 |
| Claude API usage | You set a monthly cap; ₹0 with AI features off | From milestone 4 |
| Apple developer account | $99 a year | v1.1 (iOS) |
| Hosting, database, CI, monitoring, website | Free tiers (Oracle Cloud, Cloudflare, GitHub, Sentry, EAS) | Throughout |
| Lawyer review of privacy policy and terms | Get quotes; ask for a fixed fee | Before milestone 6 |
| Coach and dietitian review | Get quotes; or a university nutrition or sports-science department | Before milestone 6 |

Free tiers have limits: Oracle can reclaim idle free VMs and EAS limits monthly builds, so nightly backups and local builds are the fallback.

## Risks and what we do about them

The biggest risks are losing user data, AI costs running away and a store rejection; each has a prevention and a fallback.

| Risk | Prevention | If it happens anyway |
| --- | --- | --- |
| Sync bug loses or duplicates data | Client UUIDs, versions, conflict log, heavy sync tests, offline end-to-end test | Restore from nightly backup; conflict log shows both versions |
| AI costs grow faster than expected | Server quotas, budget alert, cheapest model, cache | Kill switch per feature; app keeps working without AI |
| Play Store rejects the app | Data safety form, health declaration, in-app deletion, disclaimer done early | Fix the cited policy and resubmit; web app stays live meanwhile |
| Wrong advice harms someone | Health check, doctor clearance, coach and dietitian review, no medical claims | Remove or correct content in the next content bundle without an app release |
| Agent-written code hides bugs | Small PRs, tests required, golden numbers, human review of every merge | Revert the PR; add a test that would have caught it |
| Free hosting disappears | Docker setup, nightly off-site backups | Redeploy to another host from the same Compose file within a day |
| Part-time time runs short | Milestones sized to 10–12 hours a week; scope cut list ready | Ship v1 without the lowest items in the scope table |
| One person holds all knowledge | ADRs, AGENTS.md, runbooks in `docs/` | Anyone (or any agent) can pick up from the docs |
| Sign-in breaks | Two sign-in methods; monitoring on auth errors | Email one-time code still works if Google fails |

## First two weeks

The first two weeks set up the foundations every agent depends on; no feature work starts until they’re done.

- [ ] Create the private GitHub monorepo with the folder layout above, branch protection on `main`, and `docs/AGENTS.md`
- [ ] Write ADR 001 (React Native + Expo, Spring Boot, MySQL, offline-first sync) and ADR 002 (no IFCT data; USDA + own recipes)
- [ ] Draft the OpenAPI spec for auth, sync and foods; review and merge it before any implementation
- [ ] Port `packages/core` from the prototype: setup targets, plan engine, progression; golden-number tests against prototype outputs
- [ ] Spring Boot skeleton: health endpoint, Flyway with the first migrations, Testcontainers test, Dockerfile
- [ ] Expo skeleton: tabs, local SQLite, one screen reading `core`
- [ ] GitHub Actions running lint, types and tests for all three
- [ ] Oracle Cloud free VM with Docker Compose for staging; nightly backup script to R2
- [ ] Buy the domain; Astro landing page with a placeholder privacy policy
- [ ] Keep using the prototype daily and record kitchen tests; note every bug or annoyance as an issue
