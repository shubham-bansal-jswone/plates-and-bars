# Plate & Bar mobile app

Expo (SDK 58) + TypeScript strict + Expo Router. Offline first: records live in expo-sqlite, tokens in expo-secure-store. M0 skeleton: four tabs matching the prototype (Food, Workout, Progress, Targets), a SQLite database opened on start with a `schema_version` table and one migration, and a Targets tab showing the daily targets that `packages/core` computes from a fixed demo profile.

## Commands (Node 22, run in `apps/mobile`)

```
npm ci
npm start            # Expo dev server (press a for Android, w for web)
npm run android      # needs an emulator or device
npm run web
npm run lint
npm run typecheck
npm test
npx expo export --platform web   # production web bundle; proves Metro resolves core
```

## How `packages/core` is resolved

`package.json` depends on `"@plate-and-bar/core": "file:../../packages/core"` (no workspaces). `npm ci` symlinks it into `node_modules/@plate-and-bar/core`; its `main` is the TypeScript source `src/index.ts`.

- Metro: `metro.config.js` adds `packages/core` to `watchFolders`, because the symlink's real path is outside the app root.
- Jest: `jest-expo` transforms TypeScript with Babel. The real path (`packages/core/src`) is not under `node_modules`, so it is transformed; no extra mapping is needed.
- Dependencies of core: only `apps/mobile` is installed in CI, so core's own `node_modules` may not exist. Babel injects `@babel/runtime` imports into core's source, which must resolve from this app: Jest uses `moduleDirectories: ['node_modules', '<rootDir>/node_modules']`, Metro uses `resolver.nodeModulesPaths`. Test this by deleting `packages/core/node_modules` first.
- TypeScript: resolves through the symlink and `types` in core's `package.json`.

## Layout

- `app/` Expo Router routes; `app/(tabs)/` the four tabs.
- `src/theme/` light/dark palettes copied from the prototype's `:root` CSS; follows the system scheme.
- `src/db/migrations.ts` ordered migrations plus the migrator (`schema_version` table). Add new schema as a new entry; never edit shipped ones.
- `src/secure/tokens.ts` token storage in the OS keystore (no auth flow yet).
- `src/screens/TargetsScreen.tsx` the screen reading `calcTargets`.

## Notes

- Expo-managed packages move only with the SDK upgrade (#58): `expo`, `expo-*`, `@expo/*`, `react`, `react-dom`, `react-test-renderer`, `react-native`, `react-native-*`, `jest-expo`, `eslint-config-expo`, `@types/react` and `@types/jest`. They must line up with each other, so bumping one alone can pass `npm test` and still break at runtime. Dependabot ignores them (`.github/dependabot.yml`) — `react-test-renderer` is on that list so it can never drift from `react` if it ever returns — and their security advisories arrive through the SDK-upgrade path rather than as individual PRs.
- Content bundles: screens read `content/*.json` through lazy, shape-checked getters; see `src/content/README.md`.

- The local database opens on Android, iOS and web (expo-sqlite's wasm build on web, same migrations). It needs a cross-origin isolated page; see "Run it in a browser".
- Token storage on web is the documented no-op: expo-secure-store has no web backend, so `saveTokens` stores nothing and `loadTokens` returns null (web sign-in will use in-memory tokens plus the refresh flow when auth lands). Profile and consent are in SQLite, not in tokens.
- "Skip for now" leaves setup for this session; Targets then shows "Start setup". The next launch opens setup again while no profile exists.
- `Profile.id` is null locally: Profile is a natural-key table, so its UUIDv5 (`profiles:me`) is computed when the store is bound to a signed-in user (#31) or at push time. Consent rows are dated records with random ids (expo-crypto `randomUUID`, MIT); a later consent adds a row and never overwrites an earlier one.
- The app opens to `/setup` when no profile is stored (consent first, then four steps, then results) and to Targets when one is. Profile and Consent are stored as the contract's snake_case JSON in the `profiles` and `consents` tables (`src/db/records.ts`).
- Placeholder screens for Food, Workout and Progress come with later issues.
- Verified with the commands above, not on an Android emulator or device.

## Barcode scanner module (#944, Android)

`modules/plate-barcode-scanner` is a local Expo module (Kotlin, autolinked from `modules/`): a CameraX preview whose frames go to zxing-cpp, which reads EAN-8, EAN-13, UPC-A and UPC-E only (no QR). Both are Apache-2.0; no ML Kit and no Play services (`expo-camera` is rejected because it pulls ML Kit). Camera frames stay in memory and are dropped: nothing is stored or sent. The module declares the CAMERA permission and marks the camera, autofocus and flash features optional; the permission and its rationale are asked from JavaScript (`src/barcode/permission.ts`).

`src/barcode/BarcodeScanScreen.tsx` wraps the view with the permission states (checking, granted, denied, blocked, unavailable), an optional torch button and a "Type the barcode instead" field that always works. It returns core's `validateBarcode` result (a scanned UPC-E comes back as the 12-digit UPC-A; a typed 8-digit number is an EAN-8), with the scan format as a hint; it re-checks the camera permission when the app becomes active again. It is behind a build-time flag, off by default (`EXPO_PUBLIC_BARCODE_SCAN=1` turns it on) and reachable only from the dev route `app/barcode-dev.tsx`; the app wiring comes later. After changing a dependency of the module, run the Android steps of the licence section below: `scripts/android-classpath.txt`, `scripts/android-native-libs.txt` and the rows in `scripts/licences.mjs` move with it.

Check there is no ML Kit or Play services after any change: `npx expo prebuild --platform android --no-install`, then in `android/` run `./gradlew --no-daemon :app:dependencies --configuration releaseRuntimeClasspath` and search the output for `mlkit`, `play-services` and `com.google.android.gms` (none today). `./gradlew --stop` afterwards.

## Label OCR engine (#1067, ADR 010)

`modules/plate-label-scanner` is the engine only: `recognize(imageUri, crop?)` returns `{ lines: [{ text, confidence, words?, box? }], ms }` (confidence 0 to 100) on Android and on the web, and throws an `OcrError` with a `code` (`disabled`, `unsupported`, `image`, `crop`, `memory`, `engine`, `data`, `failed`). There are no screens yet. `crop` is `{ x, y, width, height }` as fractions of the upright image.

- Android: Tesseract4Android 4.9.0 (Apache-2.0, Tesseract 5.5.1) built from a pinned upstream commit and vendored in `modules/plate-label-scanner/android/libs-maven/` (see its `README.md` and `infra/scripts/build-tesseract4android.sh`), plus the bundled `eng.traineddata` (tessdata_fast 4.1.0, sha256 pinned in `TessData.kt`, copied to private storage on first use). Runs off the UI thread; the image is decoded in memory only, and the engine and bitmap are freed after every scan. Unit tests and lint: `./gradlew :plate-label-scanner:testDebugUnitTest :plate-label-scanner:lintDebug` (run by android-release.yml).
- Web: tesseract.js 7.0.0 and its core, self-hosted in `public/tesseract/` (worker, three LSTM cores, the same `eng.traineddata`), loaded on demand from our own origin and never from a CDN. Licences: `public/tesseract/LICENSE.txt`.
- Build-time flag `EXPO_PUBLIC_LABEL_SCAN=1` (off by default; only `1` enables it), mapped like `EXPO_PUBLIC_BARCODE_SCAN` in android-release.yml and web-deploy.yml. With it off `recognize` throws `disabled` before anything is loaded.

## Open-source licences (#698)

The About screen lists every open-source component with its licence and notice text. The data is `src/about/licences.json`, generated by `node scripts/licences.mjs` (no extra dependency; run after `npm ci`) from:

- `package-lock.json` and `node_modules`: production packages only (the `@sentry/cli` stub is listed as the MIT stub it is); optional-only and os/cpu-specific platform binaries are skipped so the output is identical on every machine. NOTICE files are appended to the licence text. The script fails if an installed version differs from the lockfile, so a stale local install cannot produce a file that passes locally and fails in CI.
- A static scan of the Gradle files of those packages plus React Native's `libs.versions.toml` for Android libraries (a declared-libraries list, not a resolved Gradle build, so libraries those pull in are not listed). Every library must resolve to a version (a literal, a `def` in the same file, the catalogue, or the small tables in the script) and to a licence mapped per artifact; anything else fails the script instead of being skipped. Each Android row carries the licence name, the canonical licence URL and the standard licence text.
- Native code (#904): third-party C and C++ compiled into the shipped `.so` files (Hermes and React Native's Folly, glog, fmt and Boost, Fresco's libjpeg-turbo, libwebp and giflib, SQLite, Zstandard, Sentry's unwinder, zxing-cpp and CameraX's libyuv, the NDK's libc++). `scripts/android-native-libs.txt` is the committed list of `.so` file names in the release APK; `NATIVE` and `NATIVE_SO` in `scripts/licences.mjs` give each library's version, licence and the third-party code linked into it, with the upstream notice in `scripts/licence-texts/native/`. The Android release workflow lists the `.so` names of the APK it built and fails (`node scripts/licences.mjs --native-libs <file>`) if they differ from the committed list or one has no `NATIVE_SO` entry; the failed run uploads the built list. A new native library is therefore looked at on purpose: find what is linked into it (build paths and symbols in the `.so`, the upstream project's third-party list), add the entry and notice, then copy the list over.
- The bundled fonts (Inter, Roboto, OFL-1.1) and Ionicons (MIT).

`node scripts/licences.mjs --check` exits 1 when the committed file is stale; `__tests__/licences-script.test.ts` runs it, so `npm test` in CI catches a lockfile change without regeneration. Regenerate (after `npm ci`) and commit the JSON whenever `package-lock.json` changes.

The JSON is about 0.5 MB. `loadLicences` loads it with a dynamic `import()`: the web export puts it in its own chunk (`_expo/static/js/web/licences-*.js`, fetched when the list opens; confirmed in the `expo export` output), and on Android Hermes only evaluates it then (it stays inside the single JS bundle). The list screen is virtualised.

## Error tracking (#687)

`@sentry/react-native` (MIT, version pinned by Expo SDK 58's `bundledNativeModules.json`) sends crashes and errors to a self-hosted GlitchTip. It is off by default: `initErrorTracking` (`src/telemetry/errors.ts`) returns without calling `Sentry.init` unless `EXPO_PUBLIC_SENTRY_DSN` is set at build time, so there is no SDK start-up and no network traffic without it. The DSN is a build-time environment variable (never committed).

- Events carry `environment` (build-time `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, default `development`) and `release` (`plate-and-bar@X.Y.Z+versionCode`, from the app version via `expo-constants`). About shows the same version. The release workflows pass the variables (#827).
- `sendDefaultPii` false, no screenshots, no view hierarchy, no failed-request capture, the default breadcrumbs integration removed.
- Tracing is off: no `tracesSampleRate` or `tracesSampler` (any number turns tracing on in the SDK), `enableAutoPerformanceTracing` false, `tracePropagationTargets: []` so no `sentry-trace` or `baggage` header is added to any request, and `beforeSendTransaction` drops every transaction.
- `src/telemetry/scrub.ts` fails closed. `beforeSend` builds the outgoing event from an allowlist of fields: event id, time, platform, level, release, environment, SDK info, the exception type, mechanism and stack frames (function, file without query, line), allowlisted device and app contexts, and the user reduced to a random install id (kept in the keystore, not tied to an account). Exception values and `message` are blanked or dropped (a `JSON.parse` error quotes its input), and `logentry`, `extra`, `tags`, `request`, `transaction`, `fingerprint`, `spans`, `threads` and frame variables are dropped. Breadcrumbs keep only type, category, level and time (no message, no data); console and network breadcrumbs are dropped. A key filter (food, meal, weight, measure, health, answer, token, email, password, secret, authorization, cookie, profile, photo, lab) is a second guard on the contexts that have no fixed key set.
- Native (Android) crashes are sent by the native SDK and do not pass through the JS `beforeSend`. They carry stack frames, device data and the same scope: the install id and the already scrubbed breadcrumbs.
- `@sentry/cli` is FSL-1.1-MIT (source-available, not open source) and a hard dependency of the SDK. `package.json` `overrides` replace it with the empty MIT stub in `stubs/sentry-cli` (declared as a dependency so the override can point at it). We upload no source maps, so nothing needs the real CLI. `__tests__/no-fsl-packages.test.ts` fails if any FSL package is in the lockfile. Do not add the `@sentry/react-native/expo` config plugin; it needs the CLI for source-map upload.
- The SDK adds `ACCESS_NETWORK_STATE` to the Android manifest. Crash reporting (when a DSN is set) and that permission belong in the privacy notice and the Play data-safety answers; a docs follow-up covers this.
- Test: `__tests__/error-tracking.test.ts`.

## Run it in a browser

Dev server (sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, set in `metro.config.js`):

```
cd apps/mobile
npm ci
npx expo start --web --port 8081     # open http://localhost:8081
```

Static export, served with the same headers (the export includes `dist/_headers` from `public/_headers`, which Cloudflare Pages applies):

```
npx expo export --platform web
cat > dist/serve.json <<'JSON'
{"headers":[{"source":"**","headers":[
  {"key":"Cross-Origin-Opener-Policy","value":"same-origin"},
  {"key":"Cross-Origin-Embedder-Policy","value":"require-corp"}]}]}
JSON
npx serve@latest dist -l 8080 --single      # open http://localhost:8080
```

Without the two headers the page is not cross-origin isolated and the database does not open on web.

`app.json` passes `{ "asyncRoutes": false }` to the `expo-router` plugin: SDK 58 otherwise splits every route into its own JS file, loaded only when that route is first opened. On a page with no service worker that breaks the offline-first rule for the web build - a screen the user has not opened online yet cannot be opened at all offline (the e2e suite's offline tests fail on it). With async routes off the export is one `entry-*.js` plus the SQLite worker, exactly as under SDK 57.

### Offline start (service worker)

`public/sw.js` (hand-written, no dependency; copied into `dist/` by the export) lets the production web build start with no network after one online visit. `src/web/registerServiceWorker.ts` registers it (production web only; the dev server and native are untouched). Because `expo export` gives the worker no build step, it learns the hashed file names from the live `index.html` and the bundles, caches them under `pb-shell-<entry bundle path>`, following the entry bundle to the SQLite worker bundle (the only place the wasm path appears). Cached responses keep their COOP/COEP headers, so the page stays cross-origin isolated offline.

- Navigations are network-first (a deploy shows up on the next load and triggers a new cache build in the background); offline they get the cached `index.html`. Hashed `/assets/` and `/_expo/static/` files are cache-first.
- Only those precached same-origin GET files are ever stored or served. API calls (another origin, or any `/api/` or `/auth/` path) pass straight through and are never cached.
- Update flow: the new cache is built next to the old one and the old one is deleted only once the new one is complete, so nobody is left on a half-cached or stale bundle; no reload prompt is needed (single bundle, no lazy chunks).
- Hosting: `sw.js` must be served with `Cache-Control: no-cache` (Caddyfile.web already revalidates everything not hashed; Cloudflare Pages revalidates by default) and a CSP needs `worker-src 'self'` (#749).
- Tests: `__tests__/service-worker.test.ts`, and `tests/e2e/specs/offline.spec.mjs` (load, wait for the cache, go offline, reload, the app starts).

Check that data survives a reload (needs a local Chrome; set `CHROME_PATH` if it is not in a standard place):

```
npx expo export --platform web && node scripts/web-reload.mjs
```

It serves `dist/` with the headers, completes setup in headless Chrome with the network switched off (all writes are local), tries a reload offline (the export carries `sw.js` now, so this usually comes back from the service worker; the script logs whichever way it goes, and `tests/e2e/specs/offline.spec.mjs` is what asserts the offline start), goes back online, reloads, and checks the Targets screen comes back from SQLite without asking for setup again.

## Tests under load

`npm run test:load` (`scripts/test-under-load.mjs`) runs the jest suite while CPU burner processes keep the machine busy, to catch tests that depend on wall-clock time (#660). `--burners N` sets the number of burners (default one per CPU), `--stall-ms MS` also blocks the event loop for MS ms on every turn inside each test file (a slow machine on demand; it makes a file many times slower, so use it on single files, not the whole suite), and any other argument goes to jest (`--maxWorkers=2` is added unless you pass your own `-w`, `--maxWorkers`, `-i` or `--runInBand`). It is for a manual or nightly run, not every pull request. A test that fails here but passes alone and on a quiet machine waits on real time: drive it with a gate, a count of event-loop turns (`until`/`turns` in `__tests__/sync-helpers.ts`) or a scoped fake clock, as `__tests__/recovery-reentry.test.tsx` does, never a longer timeout or a retry. If the script itself is SIGKILLed, jest is left to finish on its own, but the burners always stop (no handler can run on SIGKILL, so they notice the parent is gone and quit by themselves).

## Website links (#825)

The privacy policy, terms and account deletion links (About, Your data, setup consent) point at the website origin in `EXPO_PUBLIC_SITE_URL`, an `https://` URL set at build time. Unset or not https, the links are hidden. The release workflows pass it (#827).

## Phone step counter (#300)

`modules/device-steps` is a local Expo module (Kotlin, Android only): it reads `Sensor.TYPE_STEP_COUNTER` through `SensorManager`, with no Google Play services, and returns the raw since-boot counter plus the uptime. It adds the `ACTIVITY_RECOGNITION` permission (runtime, API 29+, asked from `src/steps/sensor.ts` after our own explanation) and no `.so` or Maven artifact. The day-delta and reboot rules are in `packages/core` (`advanceSteps`); `src/steps/store.ts` keeps the baseline in the device-local `settings` table and writes `steps_source: 'device'` with `patchDayNote`. The Targets toggle is off by default and hidden on web, iOS and Expo Go (no module there), which keep typing steps in. The module needs a development build (`npx expo prebuild`, `npx expo run:android`); jest mocks `src/steps/sensor.ts`.
