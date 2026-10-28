# Play Console: Data safety and Health apps declaration

Status: draft answers for the owner to paste (#695), updated for v1.1 (#975) against `main` at `f673fbbf` on 2026-10-19. Google holds the developer alone responsible for accurate declarations and may act on a mismatch with app behaviour [G1], so re-check this file against the app, the contract and the privacy page before each submission. Placeholders in `[brackets]` are filled in by the owner.

Inputs: the v1.1 Android modules in `apps/mobile/modules/`, `ADR 008` and `ADR 009` in `docs/adr/`, `backend/src/main/resources/application.yml`, `packages/api/openapi.yaml` (what the server accepts), `apps/mobile/src/sync`, `apps/mobile/src/ai`, `apps/mobile/src/photos`, `apps/mobile/src/account`, `apps/mobile/app.json`, `apps/site/src/pages/privacy.astro` and `delete-account.astro`.

## v1.1 owner checklist (Play Console, screen by screen)

Work top to bottom. "Backed by" gives the issue or PR and the code path or privacy-page section the answer comes from (privacy page = `apps/site/src/pages/privacy.astro`, section "Device features and permissions" unless named). **OWNER TO CONFIRM** means the repository cannot settle it; the reason is given. Do each screen against the build you upload: the build decides several answers (see "Which build" below).

### Which build (decide first)

| Fact on `main` | Effect | Backed by |
| --- | --- | --- |
| The scanner and live pose tracking are build-time flags, `EXPO_PUBLIC_BARCODE_SCAN=1` and `EXPO_PUBLIC_POSE_TRACKING=1`. Only `.github/workflows/ci.yml` (lines 316 and 326) sets them. `.github/workflows/android-release.yml` does not map them yet (the infra PR #1057 adds that), so a release built by that workflow hides both features | Both features are off for users in that build. The CAMERA permission is still in the merged manifest, because the native modules are always linked. Declare the permission either way; the "what is sent" answers for barcode apply only if the flag is on **and** the server has `OFF_ENABLED=true` | #944, #947, `apps/mobile/src/barcode/flag.ts`, `apps/mobile/src/pose/flag.ts`, `backend/src/main/resources/application.yml` (`off.enabled` default false) |
| **OWNER STEP before any store build:** set `ANDROID_API_URL` as an `android-release` environment variable. The two feature flags (`EXPO_PUBLIC_BARCODE_SCAN`, `EXPO_PUBLIC_POSE_TRACKING`) can be set the same way only once the infra PR that maps them in `android-release.yml` (#1057; `RUNBOOK` section 8.4 lists the variables) has merged | There are no repository or environment variables today, so a build from the workflow has the barcode and pose flags off and no server URL (no account, no sync, no barcode lookup). Set the URL, and the flags if wanted (after that infra PR), before the store build, and answer Data safety for the build you then upload: barcode rows apply only if the scanner flag is on, the server URL is set and the server has `OFF_ENABLED=true` | `.github/workflows/android-release.yml` (`ANDROID_API_URL`, no `EXPO_PUBLIC_BARCODE_SCAN` or `EXPO_PUBLIC_POSE_TRACKING`), no repository or environment variables exist (review of #1055) |
| The three AI image calls are off on the server: `AI_MEAL_PHOTO_ENABLED`, `AI_IMPORT_RECIPE_ENABLED`, `AI_FORM_CHECK_ENABLED` default false, `AI_MONTHLY_BUDGET_TOKENS` defaults to 0 (keeps every feature off), and `StubAiProvider` is the only provider | No image leaves the device today | #997, #1003, ADR 008, `application.yml` (`ai.*`), `backend/.../ai/StubAiProvider.java` |

### Screen 1. App content > Data safety > Data collection and security

| Field | Answer | Backed by |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | Yes. Since v1.1 this is true even for a user with no account: a barcode lookup goes to our server with no sign-in (`GET /foods/barcode/{code}` is public). Data leaves the device only when the scanner flag is on, the server URL (`EXPO_PUBLIC_API_URL`) is set and the server has `OFF_ENABLED=true`. Keep Yes for a build with a server URL | #944, #987, `apps/mobile/src/barcode/lookup.ts` ("public: no token"), ADR 009 |
| Encrypted in transit | Yes (unchanged) | see "Data collection and security" below |
| Account creation, deletion URL, deletion request | Unchanged | see "Data collection and security" below |
| Does the barcode cache need a deletion path? | No. The cache is keyed by barcode digits only, with no user id, so `DELETE /me` and `GET /me/export` do not touch it. State this if Google asks | #987, `backend/src/main/resources/db/migration/V10__barcode_cache.sql`, ADR 009, privacy page "Retention" |

### Screen 2. Data safety > Data types: tick these

Unchanged from the list in "Data types" below, plus the following changes. Tick the types in the first table now. Tick the second table only on the day the AI image features go live.

| Category > type | Tick now? | Collected | Shared | Optional | Ephemeral | Purpose | Backed by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Health and fitness > Fitness info (already ticked) | Yes, wording extended: add "steps counted by the phone's step sensor" | Yes | No | Optional | No | App functionality | #963, #300, `apps/mobile/src/steps/store.ts` (`syncDeviceSteps` writes only the day's `steps` and `steps_source: 'device'` into the day note), `DayNote.steps_source` in `packages/api/openapi.yaml`, `apps/mobile/src/steps/copy.ts`; privacy page "Step counter". Raw sensor readings and the baseline stay in the device-only `settings` table (`KEY_STEPS_BASELINE`) |
| Barcode digits: **OWNER TO CONFIRM the type** (see below) | Yes, if the build has the scanner on | Yes (leaves the device to our server, with no account) | **OWNER TO CONFIRM** (see below) | Optional (the user can type the food in) | **OWNER TO CONFIRM** | App functionality | #944, #987, ADR 009, `apps/mobile/src/barcode/lookup.ts`, `backend/.../foods/BarcodeService.java`, privacy page "Camera" and "Retention" |

Barcode digits: Google's data-type list has no "barcode" or "food lookup" type, and the repo cannot say which one Google's review would expect. Recommended answer: **App activity > Other actions** (the user scanned a barcode), collected, optional, App functionality. **OWNER TO CONFIRM** against the live type descriptions in the form [G1]. Shared: ADR 009 and #995 describe the lookup to Open Food Facts as going out through our server, with a fixed User-Agent and no IP, name or account. Open Food Facts is a public database we query, not a service provider processing user data on our behalf, so the "service provider" exclusion in [G1] may not cover it. The safe answer is **Shared: Yes** with purpose App functionality. **OWNER TO CONFIRM** with the lawyer. Ephemeral: the code is also kept in our cache for 30 days (24 hours for a miss), so answer **No** (not ephemeral). The cache row has no user id, but our server does see the digits together with the request's IP address, which is held in memory only for rate limiting (`docs/adr/009`, "Abuse limits").

If the whole barcode path is off in the uploaded build, none of this is declared yet.

Only when the AI image features are turned on (see "AI image calls: what changes on the day"): add Photos and videos > Photos.

### Screen 3. Data safety > per-type details when the AI image features are on

Do not tick on 2026-10-19: no image is sent. These are the answers for the day the three flags are turned on and a provider is deployed.

| Category > type | Collected | Shared | Optional | Ephemeral | Purpose | Backed by |
| --- | --- | --- | --- | --- | --- | --- |
| Photos and videos > Photos | Yes: the meal photo, the photo of a recipe page, and 2 to 4 still frames of a form check. All re-encoded as small JPEGs on the device and again on the server | **OWNER TO CONFIRM**: No only if the [AI provider] terms make it a processor that does not keep or train on the images. ADR 008 decision 5 requires exactly that terms set, and the provider is not chosen yet (#926). If it cannot be confirmed, answer Yes | Optional (signed in, AI switched on by the user, feature on the server) | **Yes**: held in memory for one request, never stored, logged or cached, including identical repeat requests | App functionality | #997, #1003, ADR 008 decisions 3, 4 and 5, `apps/mobile/src/ai/photo.ts` and `frames.ts`, `AiImageEndpointsIT` (`imageCallsAreNeverCachedNotEvenForAnIdenticalRequestOrATextOnlyRecipe`), privacy page "AI" paragraph on image features |
| Photos and videos > Videos | **No.** The form-check video itself never leaves the phone; only frames cut on the device are sent | | | | | `apps/mobile/src/ai/frames.ts` (`framesFromVideo` doc comment), ADR 008 decision 4 |

### Screen 4. App content > permissions Play Console reads from the bundle

Play Console lists the permissions it finds in the uploaded bundle and shows a declaration form only for the ones that need it. For each permission below, the manifest is in the named file. **OWNER TO CONFIRM** on upload that no extra form is requested: the repo cannot see Google's current list of permissions that need a declaration, and none of the permissions below is a Health Connect permission.

| Permission | What it is for | Disclosure to give if asked | Backed by |
| --- | --- | --- | --- |
| `android.permission.ACTIVITY_RECOGNITION` | The step counter. Off by default; asked only when the user turns it on, with an in-app explanation first. The step sensor is read on the device; only the day's total syncs (like typed steps), when the user is signed in and has agreed to sync. It uses no Google services and is not Health Connect | "Physical activity: counts the user's steps from the phone's step sensor, only if the user turns the Phone step counter on in Targets" | #963, #300, `apps/mobile/modules/device-steps/android/src/main/AndroidManifest.xml`, `apps/mobile/src/steps/copy.ts`, `steps/store.ts`; `uses-feature stepcounter required=false` |
| `android.permission.POST_NOTIFICATIONS` | Local reminders only, asked when the first reminder is switched on (Android 13 and later). There is no push service: no Firebase or push dependency in `apps/mobile/package.json` or in any module's `build.gradle`. `Settings.reminders` exists in the contract (since 0.1.7), but the app keeps reminder preferences on the device under the local key `device.reminders` (`KEY_REMINDERS` in `apps/mobile/src/sync/store.ts`) and never syncs them | "Local reminder notifications set by the user; no push messages" | #956, #967, `apps/mobile/modules/plate-reminders/android/src/main/AndroidManifest.xml`, `apps/mobile/src/reminders/store.ts`, `reminders/copy.ts` (notification text has no weight, food or health detail) |
| `android.permission.RECEIVE_BOOT_COMPLETED` (normal permission, no form) | Re-arms the local reminders after a reboot, app update, or clock or time zone change. No exact-alarm permission is used (alarms are inexact) | None needed. Listed so the owner is not surprised by it in the bundle | same manifest; `grep` for `SCHEDULE_EXACT_ALARM` and `USE_EXACT_ALARM` in `apps/mobile/modules` and `plugins` finds none (2026-10-19) |
| `android.permission.CAMERA` | Barcode scanning (#974, #1004), live pose tracking (#947, #1008), progress photos, AI meal photo and form check. Asked when the user starts one of them. Barcode and pose frames are processed on the device and never recorded or sent. Progress photos are kept encrypted on the device and never sent. The AI photo features send only the chosen picture, only when AI is on, and never store or log it | "Camera: reads barcodes, tracks a set for rep counting (on-device model, nothing recorded), takes progress photos kept on the device, and takes the meal photo for the optional AI feature" | `modules/plate-barcode-scanner/android/src/main/AndroidManifest.xml`, `modules/plate-pose/android/src/main/AndroidManifest.xml`, `expo-image-picker` plugin in `apps/mobile/app.json`, `apps/mobile/src/photos/vault.ts`, `apps/mobile/src/ai/photo.ts`, ADR 008. Pose model is bundled on Android (`modules/plate-pose/android/src/main/assets/movenet_lightning_f16.tflite`) and on our own origin on the web (`apps/mobile/src/pose/pose-detector.ts`); no third-party download. All `uses-feature` camera entries are `required=false` |
| `android.permission.ACCESS_NETWORK_STATE` | Added by `@sentry/react-native` | unchanged | see "Permissions" below |
| Full merged manifest (reviewer's dump, CI run 39218850622) | `INTERNET`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`, `ACCESS_NETWORK_STATE`, `ACTIVITY_RECOGNITION`, `CAMERA`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. `SYSTEM_ALERT_WINDOW` is being removed in #1056 before the first upload, so check it is gone from the bundle. The ones not described in the rows above (`INTERNET`, `VIBRATE`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, the app's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`) are normal permissions merged from libraries and need no form | CI run 39218850622 |
| Storage and media permissions | `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are blocked in `app.json`. The merged manifest has no `READ_MEDIA_*` permission (list above), so no photo and video permissions declaration is needed | `apps/mobile/app.json` (`blockedPermissions`), merged manifest from CI run 39218850622 |

### Screen 5. AI image calls: what changes on the day

Server flags (`AI_MEAL_PHOTO_ENABLED`, `AI_IMPORT_RECIPE_ENABLED`, `AI_FORM_CHECK_ENABLED`) plus a deployed provider and a non-zero `AI_MONTHLY_BUDGET_TOKENS` are the switch. The app also needs the user signed in and AI switched on (off by default) before it asks the server (`apps/mobile/src/ai/AiProvider.tsx`). The server paragraph on images in the privacy page is already published as a draft (#995).

| Answer | Today (flags off) | After the flags are on | Backed by |
| --- | --- | --- | --- |
| Data safety: Photos and videos > Photos | Not declared | Collected, optional, ephemeral Yes, purpose App functionality; shared per the provider terms (**OWNER TO CONFIRM**) | Screen 3 above; ADR 008 |
| Data safety: Videos | Not declared | Still not declared | `frames.ts` |
| Data safety "Not collected" row for Photos and videos | "Not collected" | Remove that row; progress photos still stay on the device | "Not collected" below |
| Camera permission wording | Already declared | Unchanged, but the disclosure text now includes the AI meal photo | Screen 4 |
| Shared answers for AI inputs | per the existing [AI provider] note | Image rows follow the same provider answer | `docs/adr/008`, #926 |
| Privacy page | Draft, placeholder `[AI provider]` | Fill `[AI provider]` and publish | privacy page |
| iOS privacy manifest | Does not list Photos or Videos | Needs `NSPrivacyCollectedDataTypePhotosorVideos`; this is an App lane change, not a Play Console step; the iOS picker strings also change in #1056. `apps/mobile/__tests__/backup-config.test.ts` currently asserts it is absent and says to add it when the meal-photo AI call ships | `apps/mobile/app.json` |
| Provider terms | not applicable | Must allow no retention and no training on request data (ADR 008 decision 5); until then the three flags stay off | #926 |

### Screen 6. App content > Health apps

Fill in as in "Health apps declaration" below. v1.1 changes: **Period Tracking is now Yes** (the cycle log is on `main`, see below). Everything else stays as written. Steps from the phone's sensor, local reminders, pose tracking and the barcode scanner do not add a category: Activity and Fitness already covers them.

### Screen 7. Other App content declarations

Target audience, content rating and the other declarations are in `docs/PLAY-STORE-LISTING.md` (see its Target audience and content section). v1.1 adds nothing to them that can be confirmed from the code: the AI features are off, and the app has no ads. **OWNER TO CONFIRM** the content rating questionnaire after the AI image features go on (it asks about user-generated content and AI features in its live wording, which the repo cannot show).


## How the app moves data

| Flow | When | What leaves the device | Source |
| --- | --- | --- | --- |
| Nothing | No account (the default). The app works fully offline, except the barcode lookup row below | Nothing about the user | `apps/mobile/src/sync/copy.ts` (`optional`) |
| Barcode lookup (v1.1) | The user scans or types a barcode in Add food; the scanner build flag is on and the server has `OFF_ENABLED=true`. No sign-in needed | The barcode digits (8, 12 or 13) in the URL path of `GET /foods/barcode/{code}`, with no token, name or account. The server asks Open Food Facts for that one product (fixed User-Agent, so Open Food Facts sees our server, not the user). The server caches the answer by barcode for 30 days (24 hours if not found), with no user id. Camera frames stay on the phone | #944, #987, ADR 009, `apps/mobile/src/barcode/lookup.ts`, `backend/.../foods/BarcodeService.java`, `V10__barcode_cache.sql` |
| On-device features (v1.1) | Step counter (off by default), local reminders, live pose tracking | Nothing, except the day's step total, which is saved in the day note and syncs like typed steps when signed in and agreed to sync. Reminder settings, sensor readings, camera frames and pose data stay on the phone | #963, #956, #967, #947, #1008, `apps/mobile/src/steps/store.ts`, `reminders/store.ts`, `pose/copy.ts` |
| Content refresh | Build has a server (`EXPO_PUBLIC_API_URL` set) | A request for shared reference content (foods, exercises, cards). No user data; the IP address is used in memory only for rate limiting | `apps/mobile/src/content/ContentRefresher.tsx`, `backend/.../ratelimit/RateLimiter.java` |
| Sign-in | User chooses to sign in (email code) | Email address, then the 6-digit code. The server creates an account id and sessions. The email and code go through the SMTP provider | `apps/mobile/src/sync/auth.ts`, `/auth/email/*` in the contract |
| Sync | Signed in **and** the user taps "Agree and sync" (data_storage consent) | Every record in the `SyncTable` list (below) | `apps/mobile/src/sync/engine.ts` (`consent_required`), `SyncTable` in the contract |
| AI features | Signed in, AI switched on by the user (off by default), and the feature switched on on the server | Only the fields listed on the privacy page. The image calls (meal photo, recipe photo, 2 to 4 form-check frames, #997, #1003) send re-encoded JPEGs only, never stored, logged or cached (ADR 008); the server passes them to [AI provider] and may hold the answer in memory for 24 hours | `apps/mobile/src/ai/AiProvider.tsx`, `apps/mobile/src/ai/copy.ts`, `/ai/*` in the contract |
| Export | User taps download in "Your data" | Server copy comes down to the device; the user saves or shares the file with the system share sheet | `apps/mobile/src/account/`, `GET /me/export` |
| Crash and error reports | Build has a DSN (`EXPO_PUBLIC_SENTRY_DSN`); no user switch | Error type, stack frames, device model, manufacturer and brand, OS and app version, release and environment, a random install id (not tied to an account), breadcrumbs with type, category, level and time only. Device details: memory and storage size and free space, screen size and density, orientation, rooted, language and time zone, app identifier, build and start time, loaded library list. A session report per app use (start time, duration, crash status, release, install id): `errors.ts` leaves `enableAutoSessionTracking` at its default (on). Native Android crashes are sent by the native SDK and bypass `scrub.ts`: they can carry the native exception message, threads and the full native device context (battery level among other fields). No food, weight, health answers, messages, tokens or photos in the JS and server reports | `apps/mobile/src/telemetry/scrub.ts`, `apps/mobile/README.md` |
| Delete | User taps "Delete everything" | Deletion request; server deletes the account and its data | `apps/mobile/src/account/server.ts`, `DELETE /me` |

Never leaves the device: progress photos and kitchen-test photos (AES-256-GCM in an on-device vault, `apps/mobile/src/photos/vault.ts`; only `has_photo` syncs), and the local database (Android backup and device transfer are excluded, `apps/mobile/plugins/with-no-backup.js`, `allowBackup: false`). Cycle and lab data are not built yet and are device-only by design (`docs/development-plan.md`).

The only SDK that sends data is `@sentry/react-native` (MIT), and only in a build made with `EXPO_PUBLIC_SENTRY_DSN` set; with no DSN it is not started and sends nothing (`apps/mobile/src/telemetry/errors.ts`). It sends crash and error reports to our self-hosted GlitchTip. The mobile dependencies include no analytics, advertising or Google sign-in SDK. Fonts are bundled.

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

Every collected type except Crash logs, Diagnostics and Device or other IDs is **optional**: signing in, syncing and AI are each the user's choice, and the app works without them (Google: optional means users can choose whether to provide it [G1]). Crash logs, Diagnostics and the install id are **required** whenever the build has a DSN, because the app has no switch to turn them off. Nothing is **shared**: the SMTP provider, host, backup storage, error-tracking service and AI provider process data for us as service providers, which Google excludes from sharing [G1]. **Owner:** that holds only if the [AI provider] terms make it a processor that does not use the data for itself; if not, declare the AI inputs as shared. Nothing is collected for advertising, marketing or personalisation. Analytics is selected only for the crash-reporting rows and the hashed account id (diagnosing crashes and app performance).

| Category > type | Collected | What, specifically | Purposes | Source |
| --- | --- | --- | --- | --- |
| Personal info > Email address | Yes | Sign-in email | Account management, App functionality | `/auth/email/*`; `users.email` |
| Personal info > User IDs | Yes | Account id (UUID) made by the server; a hashed form of it is sent in backend error reports when `SENTRY_DSN` is set | Account management, App functionality, Analytics (backend crash diagnosis) | `User` in the contract |
| Personal info > Other info | Yes | Sex and age (setup answers) | App functionality | `Profile` in the contract |
| Health and fitness > Health info | Yes | Height, weight at setup, weigh-ins, body measurements, pregnancy or breastfeeding status, the six health-check answers, the date a doctor cleared the user, exclusions with reason `pain` and joints, food and water logs, user foods, recipes and kitchen tests (nutrition), calorie and macro targets, fasting days, sleep hours. AI weekly summary inputs: average weight, average calories and protein, targets, estimated burn | App functionality | `Profile`, `Weight`, `Measurement`, `Exclusion`, `FoodLog`, `WaterLog`, `UserFood`, `Recipe`, `KitchenTest`, `DayNote`, `WeeklySummaryRequest` |
| Health and fitness > Fitness info | Yes | Activity level, training days and session length, experience, goal and pace, workouts, sets, lift history, steps (typed in, or the day's total from the phone's step sensor when the user turns that on; the raw sensor readings never leave the phone), swaps, exercise preferences in settings (reminders are not included: they stay on the device under `device.reminders`). AI weekly summary inputs: sessions done and planned, lifts improved or stalled | App functionality | `Profile`, `Workout`, `WorkoutSet`, `LiftStat`, `DayNote`, `Swap`, `Settings`, `WeeklySummaryRequest` |
| App activity > Other user-generated content | Yes | Free text the user writes: kitchen-test notes, names of own foods, recipes and custom exercises; text typed into Describe a meal, Ask why questions | App functionality | `KitchenTest.note`, `UserFood`, `Recipe`, `Settings.custom_tags`, `DescribeMealRequest`, `AskWhyRequest`, `SuggestTagsRequest` |
| App info and performance > Crash logs | Yes, only if the build has a DSN. **Required** (no user switch) | Error type, stack frames, release, environment; for native Android crashes also the native exception message and threads, which `scrub.ts` does not filter | Analytics (monitoring app health and diagnosing crashes [G1]); not shared, not ephemeral. **Owner:** confirm the Analytics purpose wording against Google's live Data safety help page [G1] before submitting | `apps/mobile/src/telemetry/scrub.ts`, `apps/mobile/README.md` |
| App info and performance > Diagnostics | Yes, only if the build has a DSN. **Required** | Device model, manufacturer, OS and app version, memory and storage, screen, rooted, language and time zone, app identifier and build, session reports (start time, duration, crash status); native crashes add the native device context | Analytics | `apps/mobile/src/telemetry/scrub.ts`, `errors.ts` |
| Device or other IDs > Device or other IDs | Yes, only if the build has a DSN. **Required** | Random per-install id (`user.id` in every app report; on web a new one per page load). Native crashes carry the native SDK's installation id. Not an advertising id | Analytics | `apps/mobile/src/telemetry/errors.ts` |
| App activity > App interactions | Yes (recommended) | In-app state that syncs: science-card progress, last weekly check-in seen, dismissed suggestions | App functionality | `Settings.learn`, `checkin_seen`, `adjustments` |

Notes on judgement calls:

- **Health info vs Fitness info.** Google defines Health info as "information about health, such as medical records or symptoms" and Fitness info as "information about fitness, such as exercise or physical activity" [G1]. Food, body and health-check data are listed under Health info and training data under Fitness info; declaring both is the safe reading.
- **App interactions.** These fields are app state, not usage analytics, but they describe what the user did in the app. Declaring them costs nothing; leaving them out risks a mismatch.
- **Not ephemeral.** AI answers may be kept in memory for 24 hours, longer than the real-time request, so the AI inputs are not ephemeral processing [G1].
- **Consent records** (`Consent`: kind, time, text version) are part of the account and are not a separate form type.

### Not collected

| Category | Why not |
| --- | --- |
| Location | No location permission. The full IP address is held only in memory for rate limiting (ephemeral, not used to locate the user). Caddy's access and error logs (`infra/caddy/Caddyfile.api`, `Caddyfile.web`, `Caddyfile.stack`) keep only a masked IP (/24 for IPv4, /48 for IPv6), no query string and no headers, for 14 days |
| Photos and videos | Until the AI image features are switched on: progress photos stay in the on-device vault, and the camera and picker are used for those, for barcode scanning and for pose tracking, none of which sends pictures (`apps/mobile/app.json`, ADR 008). **When the AI image features are on, this row is wrong: declare Photos (see Screen 3 in the checklist)** |
| Files and docs | Exports are saved or shared by the user from the device; nothing is uploaded |
| Device or other IDs (other than the crash-report install id declared above) | No advertising id or hardware device id; record ids are per record (`SyncMeta.id`) |
| App info and performance > Other app performance data | No scrolling or screen-usage data. Session reports (start time, duration, crash status) and, for native crashes, battery level are declared under Diagnostics above |
| Personal info (name, address, phone, race, beliefs, orientation), Financial info, Messages, Audio, Calendar, Contacts, Web browsing | Not asked for or sent anywhere |

## Draft rows for the deferred pre-production pass (#975)

Draft, not submitted. Per the owner decision on #975 (2026-10-20) the Play Console declarations are deferred until the owner says so. These rows summarise Screen 4 and the privacy page "Device features and permissions" for the three v1.1 permissions plus label scanning; re-check each against the code before submitting.

| Permission or feature | Status | Data safety answer (draft) | Backed by |
| --- | --- | --- | --- |
| Physical activity (`ACTIVITY_RECOGNITION`) | draft, not submitted | Fitness info: the day's step total syncs like typed steps, optional, only after the user turns the step counter on and signs in with sync agreed. The sensor stream does not leave the phone | `modules/device-steps/android/src/main/AndroidManifest.xml`, `apps/mobile/src/steps/` |
| Notifications (`POST_NOTIFICATIONS`) | draft, not submitted | Nothing collected for this permission: local reminders only, no push service or token | `apps/mobile/src/reminders/`, no push dependency in `apps/mobile/package.json` |
| Camera (`CAMERA`) | draft, not submitted | Barcode and pose frames are processed on the device and not sent. Barcode digits (not the image) go to our server for lookup, so the app still collects data | `modules/plate-barcode-scanner`, `modules/plate-pose`, `apps/mobile/src/barcode/lookup.ts` |
| Label scan (uses the camera or a picked photo, no new permission) | draft, not submitted | Read on the device by Tesseract; the app deletes its cached working copy after the scan; only reviewed numbers are saved as a food. Add to the Camera rationale when declaring | ADR 010, `apps/mobile/src/labelscan/capture.ts` (`releasePhoto`), `photos/capture.ts` (`discard`) |

## Permissions

The Android permissions in the merged manifest (full list in checklist Screen 4), with the reason and the source, are in checklist Screen 4. `@sentry/react-native` adds `android.permission.ACCESS_NETWORK_STATE`, which lets it tell whether the phone is online; the privacy page lists it. The Data safety form asks about data, not permissions. **Owner:** check the built manifest, because several permissions (the Sentry one, the local modules' CAMERA, ACTIVITY_RECOGNITION, POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED, and anything the picker library adds) are merged in at build time.

## What changes the answers

| Change | Update |
| --- | --- |
| Release build without `EXPO_PUBLIC_API_URL` (no server) | Answer "No" to collection: nothing leaves the device, and there is no account to delete. On 2026-10-17 nothing in the repository sets this variable, including `.github/workflows/android-release.yml`, so check which case the uploaded build is |
| AI never switched on in production (all `AI_*_ENABLED` false), or no real AI provider deployed. Today `StubAiProvider` is the only provider, so `GET /ai/status` reports every feature off and the app sends no AI request | Remove the AI-only items (Describe a meal and Ask why text, weekly summary inputs). Everything else stays because sync collects it |
| AI switched on | As written above. Confirm the [AI provider] terms (service provider or third party) and update the privacy page placeholder |
| Release built without `EXPO_PUBLIC_SENTRY_DSN` | Remove Crash logs and Diagnostics, and the Device or other IDs row. The SDK is linked into every build, so `ACCESS_NETWORK_STATE` stays in the manifest either way (check the built manifest) |
| Backend `SENTRY_DSN` set | Backend events carry one hashed account id and no health data, so no new type; User IDs is already declared, and Analytics is added to its purposes because the id is collected for crash diagnosis. Set `SENTRY_ENVIRONMENT=production` with the DSN |
| Health Connect steps | Not used: v1.1 reads the phone's step sensor directly (#963). If Health Connect is added later, also complete its permission declaration in Play Console |
| Google sign-in added to the app | Add Google as an account creation method; the email and user id answers stay |
| Cycle log (v1.1, on `main`) | Device-only, so no Data safety change (`apps/mobile/src/db/cycle.ts`: a table outside `SYNC_TABLES`, no contract field; `apps/mobile/src/cycle/copy.ts`; privacy page). Period Tracking is Yes in the Health apps declaration |
| Lab reports (v2) | Revisit both forms with legal and medical review |

## Health apps declaration

All apps on any track must file it; options and wording are from Google's help page [G3].

| Option | Select | Why |
| --- | --- | --- |
| Health and fitness > Activity and Fitness | Yes | Training plans, workout logging, weigh-ins, body measurements, the phone step counter (#963) and live pose tracking for rep counting (#947) |
| Health and fitness > Nutrition and Weight Management | Yes | Food logging, calorie and macro targets, meal plans, weight goals |
| Health and fitness > Sleep Management | No | Sleep is one optional number per day with no sleep features |
| Health and fitness > Period Tracking | Yes (v1.1) | The optional cycle log is built (`apps/mobile/src/cycle/CycleSection.tsx`, shown in Progress); it is kept on the device only and never uploaded (#625). Answer Yes |
| Health and fitness > Stress Management, Relaxation, Mental Acuity | No | |
| Medical (all items) | No | The six health-check questions are a safety screen that tells the user to see a doctor; the app gives no diagnosis or treatment. **Owner:** confirm with the medical and legal review that this is not Clinical Decision Support |
| Medical Device Apps | No | Not a regulated medical device |
| Health subjects research > Research studies, clinical trials, and patient communities | No | Labels as on the help page [G3], fetched 2026-10-17 |

## Before submitting

- Privacy policy and deletion pages are drafts pending lawyer review; publish final versions at `https://[site host]/privacy/` and `/delete-account/` first.
- The error-tracking DSN (`EXPO_PUBLIC_SENTRY_DSN`, backend `SENTRY_DSN` with `SENTRY_ENVIRONMENT=production`) goes in only after the items below.
- The privacy page's "Crash and error reports" section (which describes native crashes and session reports) is published.
- The retention placeholder `[error report retention period]` is filled in.
- Optional: an app follow-up sets `enableAutoSessionTracking: false` and adds a native-side scrubber. Until then, the Crash logs and Diagnostics rows stay as written.
- Fill `[AI provider]`, `[SMTP provider]`, `[hosting provider]` and the backup terms on the privacy page so it matches these answers.

## Sources

- [G1] Google Play Console Help, "Provide information for Google Play's Data safety section": support.google.com/googleplay/android-developer/answer/10787469 (fetched 2026-10-17).
- [G2] Google Play Console Help, "Understanding Google Play's app account deletion requirements": support.google.com/googleplay/android-developer/answer/13327111 (fetched 2026-10-17).
- [G3] Google Play Console Help, "Provide information for the Health apps declaration form": support.google.com/googleplay/android-developer/answer/14738291 (fetched 2026-10-17).
