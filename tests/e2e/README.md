# Web end-to-end tests

Playwright tests for the web build of `apps/mobile`, run against `npx expo export --platform web` served with the COOP/COEP headers expo-sqlite needs (`support/server.mjs`, same as `apps/mobile/public/_headers`). The release checklist for manual and Android checks is `RELEASE_CHECKLIST.md`.

Specs (one concern each, every test starts with an empty browser profile):

- `setup.spec.mjs`: consent, setup to Targets, profile read back after a reload.
- `logging.spec.mjs`: log a food, water, a weigh-in, a workout set, all offline, then reload online and check it persisted.
- `data.spec.mjs`: export (JSON and CSV, offline) and delete everything (local only).
- `screens.spec.mjs`: exercise library, About, recipe builder and kitchen tests.
- `a11y.spec.mjs`: axe-core on the main screens, light and dark. Known failures are listed with their issue number.

Rules: only `127.0.0.1` is reachable (every other request is aborted and fails the test); no sign-in and no server, so sync and AI are off; selectors are `aria-label`s; there are no fixed sleeps (`saved()` waits for the app's SQLite worker to answer its writes).

## Run locally

```
cd apps/mobile && npm ci && npx expo export --platform web
cd ../../tests/e2e && npm ci
npx --no-install @puppeteer/browsers install chromium@latest --path ~/.cache/pb-chromium   # prints the executable path
CHROME_PATH=<that path> npx playwright test            # all
CHROME_PATH=<that path> npx playwright test specs/data.spec.mjs   # one suite
```

Licences: `@playwright/test` Apache-2.0, `@puppeteer/browsers` Apache-2.0, Chromium BSD-3-Clause, axe-core MPL-2.0. Playwright's own browser download (`npx playwright install`) is not used; it fetches builds from Microsoft's CDN. Any local Chromium or Chrome works through `CHROME_PATH`.
