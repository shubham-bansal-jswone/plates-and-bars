# Play Console: Data safety and Health apps declaration

Status: draft answers for the owner to paste (#695), based on `main` on 2026-10-17. Google holds the developer alone responsible for accurate declarations and may act on a mismatch with app behaviour [G1], so re-check this file against the app, the contract and the privacy page before each submission. Placeholders in `[brackets]` are filled in by the owner.

Inputs: `packages/api/openapi.yaml` (what the server accepts), `apps/mobile/src/sync`, `apps/mobile/src/ai`, `apps/mobile/src/photos`, `apps/mobile/src/account`, `apps/mobile/app.json`, `apps/site/src/pages/privacy.astro` and `delete-account.astro`.

## How the app moves data

| Flow | When | What leaves the device | Source |
| --- | --- | --- | --- |
| Nothing | No account (the default). The app works fully offline. | Nothing about the user | `apps/mobile/src/sync/copy.ts` (`optional`) |
| Content refresh | Build has a server (`EXPO_PUBLIC_API_URL` set) | A request for shared reference content (foods, exercises, cards). No user data; the IP address is used in memory only for rate limiting | `apps/mobile/src/content/ContentRefresher.tsx`, `backend/.../ratelimit/RateLimiter.java` |
| Sign-in | User chooses to sign in (email code) | Email address, then the 6-digit code. The server creates an account id and sessions. The email and code go through the SMTP provider | `apps/mobile/src/sync/auth.ts`, `/auth/email/*` in the contract |
| Sync | Signed in **and** the user taps "Agree and sync" (data_storage consent) | Every record in the `SyncTable` list (below) | `apps/mobile/src/sync/engine.ts` (`consent_required`), `SyncTable` in the contract |
| AI features | Signed in, AI switched on by the user (off by default), and the feature switched on on the server | Only the fields listed on the privacy page; the server passes them to [AI provider] and may hold the answer in memory for 24 hours | `apps/mobile/src/ai/AiProvider.tsx`, `apps/mobile/src/ai/copy.ts`, `/ai/*` in the contract |
| Export | User taps download in "Your data" | Server copy comes down to the device; the user saves or shares the file with the system share sheet | `apps/mobile/src/account/`, `GET /me/export` |
| Delete | User taps "Delete everything" | Deletion request; server deletes the account and its data | `apps/mobile/src/account/server.ts`, `DELETE /me` |

Never leaves the device: progress photos and kitchen-test photos (AES-256-GCM in an on-device vault, `apps/mobile/src/photos/vault.ts`; only `has_photo` syncs), and the local database (Android backup and device transfer are excluded, `apps/mobile/plugins/with-no-backup.js`, `allowBackup: false`). Cycle and lab data are not built yet and are device-only by design (`docs/development-plan.md`).

No SDKs collect data: the mobile dependencies (`apps/mobile/package.json`) include no analytics, advertising, crash reporting or Google sign-in SDK. Fonts are bundled.

## Data safety form answers

Form categories, data types, purposes and the definitions of "collected", "shared", "ephemeral" and "optional" are from Google's Data safety help page [G1].

### Data collection and security

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | Yes | Sign-in, sync and AI send data to our server (collection = data leaving the device [G1]) |
| Is all of the user data collected by your app encrypted in transit? | Yes | The API is HTTPS only behind Caddy with HSTS (`infra/caddy/Caddyfile.api`); SMTP uses STARTTLS (`SMTP_STARTTLS` default true in `backend/src/main/resources/application.yml`). **Owner:** the release build's `EXPO_PUBLIC_API_URL` must be an `https://` URL |
| Account creation method (the help page [G1] does not list these options; pick the closest one shown in Play Console) | Email address with a one-time code, no password. Not Google sign-in: the API supports it, the Android app does not use it | `apps/mobile/src/sync/auth.ts` |
| Account deletion URL | `https://[site host]/delete-account/` | `apps/site/src/pages/delete-account.astro`; apps with accounts must offer an in-app path and a web link that works without the app, and enter the link in the Data safety form [G2]. The page offers an emailed request handled by a person |
| Do you provide a way for users to request that their data is deleted? | Yes (in the app, "Your data" > "Delete everything", and the web page above) | `DELETE /me`; the privacy page lists what is kept: an anonymous monthly AI token total with no user id, server logs with opaque ids, backups up to [30] days |

### Data types

Every collected type is **optional**: signing in, syncing and AI are each the user's choice, and the app works without them (Google: optional means users can choose whether to provide it [G1]). Nothing is **shared**: the SMTP provider, host, backup storage and AI provider process data for us as service providers, which Google excludes from sharing [G1]. **Owner:** that holds only if the [AI provider] terms make it a processor that does not use the data for itself; if not, declare the AI inputs as shared. Nothing is collected for analytics, advertising, marketing or personalisation.

| Category > type | Collected | What, specifically | Purposes | Source |
| --- | --- | --- | --- | --- |
| Personal info > Email address | Yes | Sign-in email | Account management, App functionality | `/auth/email/*`; `users.email` |
| Personal info > User IDs | Yes | Account id (UUID) made by the server | Account management, App functionality | `User` in the contract |
| Personal info > Other info | Yes | Sex and age (setup answers) | App functionality | `Profile` in the contract |
| Health and fitness > Health info | Yes | Height, weight at setup, weigh-ins, body measurements, pregnancy or breastfeeding status, the six health-check answers, the date a doctor cleared the user, exclusions with reason `pain` and joints, food and water logs, user foods, recipes and kitchen tests (nutrition), calorie and macro targets, fasting days, sleep hours. AI weekly summary inputs: average weight, average calories and protein, targets, estimated burn | App functionality | `Profile`, `Weight`, `Measurement`, `Exclusion`, `FoodLog`, `WaterLog`, `UserFood`, `Recipe`, `KitchenTest`, `DayNote`, `WeeklySummaryRequest` |
| Health and fitness > Fitness info | Yes | Activity level, training days and session length, experience, goal and pace, workouts, sets, lift history, steps (typed in), swaps, exercise preferences and reminders in settings. AI weekly summary inputs: sessions done and planned, lifts improved or stalled | App functionality | `Profile`, `Workout`, `WorkoutSet`, `LiftStat`, `DayNote`, `Swap`, `Settings`, `WeeklySummaryRequest` |
| App activity > Other user-generated content | Yes | Free text the user writes: kitchen-test notes, names of own foods, recipes and custom exercises; text typed into Describe a meal, Ask why questions | App functionality | `KitchenTest.note`, `UserFood`, `Recipe`, `Settings.custom_tags`, `DescribeMealRequest`, `AskWhyRequest`, `SuggestTagsRequest` |
| App activity > App interactions | Yes (recommended) | In-app state that syncs: science-card progress, last weekly check-in seen, dismissed suggestions | App functionality | `Settings.learn`, `checkin_seen`, `adjustments` |

Notes on judgement calls:

- **Health info vs Fitness info.** Google defines Health info as "information about health, such as medical records or symptoms" and Fitness info as "information about fitness, such as exercise or physical activity" [G1]. Food, body and health-check data are listed under Health info and training data under Fitness info; declaring both is the safe reading.
- **App interactions.** These fields are app state, not usage analytics, but they describe what the user did in the app. Declaring them costs nothing; leaving them out risks a mismatch.
- **Not ephemeral.** AI answers may be kept in memory for 24 hours, longer than the real-time request, so the AI inputs are not ephemeral processing [G1].
- **Consent records** (`Consent`: kind, time, text version) are part of the account and are not a separate form type.

### Not collected

| Category | Why not |
| --- | --- |
| Location | No location permission. The IP address is held only in memory for rate limiting (ephemeral, not used to locate the user); Caddy has no access log configured (`infra/caddy/Caddyfile.api`) |
| Photos and videos | Photos stay in the on-device vault; camera and gallery permissions are for that only (`apps/mobile/app.json`) |
| Files and docs | Exports are saved or shared by the user from the device; nothing is uploaded |
| Device or other IDs | No advertising id or device id; record ids are per record (`SyncMeta.id`) |
| App info and performance | No crash or diagnostics SDK today |
| Personal info (name, address, phone, race, beliefs, orientation), Financial info, Messages, Audio, Calendar, Contacts, Web browsing | Not asked for or sent anywhere |

## What changes the answers

| Change | Update |
| --- | --- |
| Release build without `EXPO_PUBLIC_API_URL` (no server) | Answer "No" to collection: nothing leaves the device, and there is no account to delete. On 2026-10-17 nothing in the repository sets this variable, including `.github/workflows/android-release.yml`, so check which case the uploaded build is |
| AI never switched on in production (all `AI_*_ENABLED` false) | Remove the AI-only items (Describe a meal and Ask why text, weekly summary inputs). Everything else stays because sync collects it |
| AI switched on | As written above. Confirm the [AI provider] terms (service provider or third party) and update the privacy page placeholder |
| GlitchTip or another crash SDK added (`infra/OBSERVABILITY.md`) | Add App info and performance > Crash logs and Diagnostics, purpose App functionality (and Analytics if used for that); add User IDs if events carry the account id |
| Health Connect steps (v1 plan) | Fitness info already covers steps. Also complete the Health Connect permission declaration in Play Console |
| Google sign-in added to the app | Add Google as an account creation method; the email and user id answers stay |
| Cycle log (v1.1) | If it stays on the device, no Data safety change; add Period Tracking to the Health apps declaration |
| Lab reports (v2) | Revisit both forms with legal and medical review |

## Health apps declaration

All apps on any track must file it; options and wording are from Google's help page [G3].

| Option | Select | Why |
| --- | --- | --- |
| Health and fitness > Activity and Fitness | Yes | Training plans, workout logging, weigh-ins and body measurements |
| Health and fitness > Nutrition and Weight Management | Yes | Food logging, calorie and macro targets, meal plans, weight goals |
| Health and fitness > Sleep Management | No | Sleep is one optional number per day with no sleep features |
| Health and fitness > Period Tracking | No (yes when the cycle log ships) | Not built |
| Health and fitness > Stress Management, Relaxation, Mental Acuity | No | |
| Medical (all items) | No | The six health-check questions are a safety screen that tells the user to see a doctor; the app gives no diagnosis or treatment. **Owner:** confirm with the medical and legal review that this is not Clinical Decision Support |
| Medical Device Apps | No | Not a regulated medical device |
| Health subjects research | No | |

## Before submitting

- Privacy policy and deletion pages are drafts pending lawyer review; publish final versions at `https://[site host]/privacy/` and `/delete-account/` first.
- Fill `[AI provider]`, `[SMTP provider]`, `[hosting provider]` and the backup terms on the privacy page so it matches these answers.

## Sources

- [G1] Google Play Console Help, "Provide information for Google Play's Data safety section": support.google.com/googleplay/android-developer/answer/10787469 (fetched 2026-10-17).
- [G2] Google Play Console Help, "Understanding Google Play's app account deletion requirements": support.google.com/googleplay/android-developer/answer/13327111 (fetched 2026-10-17).
- [G3] Google Play Console Help, "Provide information for the Health apps declaration form": support.google.com/googleplay/android-developer/answer/14738291 (fetched 2026-10-17).
