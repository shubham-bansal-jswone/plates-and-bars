# Web end-to-end tests

Playwright tests for the web build of `apps/mobile`, run against `npx expo export --platform web` served with the COOP/COEP headers expo-sqlite needs (`support/server.mjs`, same as `apps/mobile/public/_headers`). The release checklist for manual and Android checks is `RELEASE_CHECKLIST.md`.

Specs (one concern each, every test starts with an empty browser profile):

- `setup.spec.mjs`: consent, setup to Targets, profile read back after a reload.
- `logging.spec.mjs`: log a food, water, a weigh-in, a workout set, all offline, then reload online and check it persisted.
- `rest-bar.spec.mjs`: the rest panel's bounding box against the page column at 1200 and 800 px, and inside the screen at 390 px (#630).
- `data.spec.mjs`: export (JSON and CSV, offline) and delete everything (local only).
- `screens.spec.mjs`: exercise library, About, recipe builder and kitchen tests.
- `food-plan.spec.mjs`: a planned meal's "Log it" (offline, once, survives a reload, and belongs to the day shown).
- `photos.spec.mjs`: progress photos on web (no camera, choose a photo, delete asks twice, cancelling the picker).
- `workout-edit.spec.mjs`: Add exercise, a typed exercise with muscle tags, Can't do and Remove exercise, offline, each checked again after a reload.
- `workout-360.spec.mjs`: the Workout screen with a started session and a ticked set has no sideways scroll at 360x640 (#900).
- `sheet-focus.spec.mjs`: a sheet opens with focus on its title and gives focus back to the opener on Escape (#661).
- `a11y.spec.mjs`: axe-core on the main screens and with each sheet open (food add, exercise settings, can't do, how to, add exercise, custom exercise, photo check-in, exercise to avoid; #661), light and dark. Known failures are listed by rule and element with their issue number (`support/axe.mjs`, tested in `axe-known.spec.mjs`); a new violation fails, a fixed one goes stale and fails.

- `pose-specs/pose.spec.mjs` (own config, `playwright.pose.config.mjs`): live pose tracking (#947) on a build with `EXPO_PUBLIC_POSE_TRACKING=1`, a fake camera and the real CSP. Run with `npm run test:pose` (see "Pose tracking test").

- `barcode-specs/barcode.spec.mjs` (own config, `playwright.barcode.config.mjs`): the web barcode scanner (#944) on a build with `EXPO_PUBLIC_BARCODE_SCAN=1`, a fake camera showing one EAN-13 and the real CSP. Run with `npm run test:barcode` (see "Barcode scanner test").

Rules: only `127.0.0.1` is reachable (every other request is aborted and every test fails at teardown if there was one); no sign-in and no server, so sync and AI are off; selectors are `aria-label`s; there are no fixed sleeps (`saved()` waits for the app's SQLite worker to answer its writes).

## Run locally

From a clean checkout:

```
cd apps/mobile && npm ci && EXPO_NO_TELEMETRY=1 npx expo export --platform web
cd ../../tests/e2e && npm ci
npm run install:chromium      # open-source Chromium into .chromium (ignored by git)
npx playwright test                              # all
npx playwright test specs/data.spec.mjs          # one suite
```

`CHROME_PATH=<chromium executable>` overrides the installed Chromium (CI sets it; CI fails if it is missing). Google Chrome is not used. 

The web server port is resolved once, in `support/port.mjs`, and the Playwright config, `support/server.mjs` and every spec's `baseURL` use that value:

- `E2E_PORT` unset or `0`: a free port is picked, so parallel local runs (two reviewers, two sessions) never collide. CI keeps 4173.
- `E2E_PORT=<n>`: that port. If something already listens there the run fails at once with a message; it never silently reuses that server, which may be a stale build.
- `E2E_REUSE=1`: reuse the server on that port on purpose (for example one you started with `node support/server.mjs` after a fresh export). Only `1` counts; CI does not set it.
- Sync tests: `E2E_SYNC_PORT` is always 4174 (0 or unset gives 4174), the origin `stack/docker-compose.yml` names in `CORS_ALLOWED_ORIGINS` and `AUTH_COOKIE_ORIGINS`. It never picks a free port. To use another port, set `E2E_SYNC_PORT=<n>` and add `http://127.0.0.1:<n>` to both lists.

`npm run test:port` checks this (taken port fails fast, `E2E_REUSE=1` reuses, `0` picks a free port); CI runs it before the browser tests.

## Pose tracking test

The feature flag is compiled into the build, so this suite has its own export and config (the fast suite's build has the flag off):

```
cd apps/mobile && EXPO_PUBLIC_POSE_TRACKING=1 npx expo export --platform web --output-dir ../../tests/e2e/.pose-dist
cd ../../tests/e2e && npm run test:pose
```

Chromium starts with `--use-fake-device-for-media-stream` (a synthetic video, no person in it), so the model runs on real frames and finds nobody. The spec checks the browser side: the screen loads under the shipped CSP with no violation, every request goes to our own origin (the weights and `.wasm` files under `/pose/` included), nothing but GET is sent, nothing of it is in the service worker cache, and with WebGL refused it falls back to single-thread WASM without a `blob:` worker. Counting with a person in view is covered by jest with a scripted model.

## Barcode scanner test

Like the pose test, the flag is compiled in, so the suite has its own export and config:

```
cd apps/mobile && EXPO_PUBLIC_BARCODE_SCAN=1 npx expo export --platform web --output-dir ../../tests/e2e/.barcode-dist
cd ../../tests/e2e && npm run test:barcode
```

Chromium starts with `--use-file-for-fake-video-capture` pointing at a clip the config writes to the temp folder (`support/ean13-video.mjs`: one EAN-13, black bars on white, no binary in git). The spec opens the scanner's dev screen (`/barcode-dev`) and checks, under the shipped CSP: with no native `BarcodeDetector` the code is read by zxing-wasm, whose chunk (`zxing-decoder-*`) and `/zxing/3.1.3/zxing_reader.wasm` (served as `application/wasm`) are fetched only when the scanner opens and are not in the service worker cache; with a native detector that lists `ean_13` neither is fetched (skipped on a Chromium without one); every request goes to our own origin and none but GET is made; the camera tracks are stopped when the scanner closes; a refused camera shows the typed-number path, which refuses a bad check digit.

## Play Store graphics (on demand, not CI)

`store/screenshots.mjs` and `store/export-graphics.mjs` generate the images in `docs/store/` (`npm run store:screenshots`, `npm run store:graphics`). They are plain scripts, not specs, so `playwright test` ignores them and CI never runs them. See `docs/store/README.md`.

## Sync tests (real backend)

`sync-specs/sync.spec.mjs`: sign in by emailed code, log a meal offline (badge says not synced), go online (badge clears), a second browser context signs in and sees the meal, delete the account on the first (the second is signed out on its next sync). `sync-specs/offline-delete.spec.mjs` adds two meals queued offline that sync when the browser comes back online, and a server delete on one device that signs the other out. It needs Docker and runs in CI as the "e2e (sync, Playwright)" job; the fast suite above never needs it.

```
cd tests/e2e/stack
CONTENT_UPDATED_AT="$(../../../backend/scripts/content-updated-at.sh)" docker compose build api   # needs a full-history checkout
docker compose up -d --wait            # MySQL, the API on 127.0.0.1:18080, Mailpit (the sign-in codes) on 18025
cd ../../../apps/mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:18080/api/v1 npx expo export --platform web --output-dir ../../tests/e2e/.sync-dist
cd ../../tests/e2e && npm run test:sync
cd stack && docker compose down -v
```

The web build needs the API URL compiled in, so it is a second export into `.sync-dist` (ignored by git). Two origins are reachable: the web server on 4174 (`E2E_SYNC_PORT`) and the API.

## Android (Maestro)

`maestro/smoke.yaml` covers setup, one meal and one set on Android. Maestro (Apache-2.0) needs an emulator or phone with the release-candidate APK installed: `maestro test maestro/smoke.yaml`. It has not been run on a device yet (none was available when it was written), so expect to adjust selectors on the first run; until it is green the Android column of `RELEASE_CHECKLIST.md` stays manual. It is not in CI (no emulator on the hosted runners).

Licences: `@playwright/test` Apache-2.0, `@puppeteer/browsers` Apache-2.0, Chromium BSD-3-Clause, axe-core MPL-2.0. Playwright's own browser download (`npx playwright install`) is not used; it fetches builds from Microsoft's CDN. Any local Chromium or Chrome works through `CHROME_PATH`.
