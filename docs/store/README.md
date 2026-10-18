# Play Store graphics

Graphics for the Google Play listing (#833). The listing text is in `docs/PLAY-STORE-LISTING.md`. Everything here is generated from files in the repo; nothing is hand-edited.

## Which Play field each file fills

Play Console > Grow users > Store presence > Main store listing > Graphics.

| File | Size | Play field |
| --- | --- | --- |
| `store-icon.png` | 512 x 512 PNG | App icon |
| `feature-graphic.png` | 1024 x 500 PNG | Feature graphic |
| `phone-1-food.png` | 1080 x 1920 PNG | Phone screenshots (1st: Food) |
| `phone-2-workout.png` | 1080 x 1920 PNG | Phone screenshots (2nd: Workout) |
| `phone-3-progress.png` | 1080 x 1920 PNG | Phone screenshots (3rd: Progress, body weight) |
| `phone-4-targets.png` | 1080 x 1920 PNG | Phone screenshots (4th: Targets) |

`feature-graphic.svg` is the editable source of the feature graphic. Play wants 2 to 8 phone screenshots, 9:16, each side between 320 and 3840 px; these are 9:16 exactly.

## How to regenerate

From a clean checkout, with Node 22.13 or newer:

```
cd apps/mobile && npm ci && EXPO_NO_TELEMETRY=1 npx expo export --platform web     # the web build the screenshots are taken from
cd ../../tests/e2e && npm ci && npm run install:chromium                          # or set CHROME_PATH to any Chromium
npm run store:graphics      # feature-graphic.png and store-icon.png
npm run store:screenshots   # phone-*.png
```

Both commands write into `docs/store/` (set `STORE_OUT=<dir>` to write elsewhere). Neither runs in CI and neither is a Playwright spec, so `npx playwright test` never picks them up.

- `tests/e2e/store/export-graphics.mjs` draws `docs/store/feature-graphic.svg` and `apps/mobile/assets/brand/icon.svg` with Chromium (a Playwright screenshot of the SVG) and embeds the two fonts from the app's own font packages at export time.
- `tests/e2e/store/screenshots.mjs` serves the web export on a free port and opens it at a 360 x 640 phone viewport at 3x (1080 x 1920), light theme, with the clock pinned to Monday 12 October 2026 and only `127.0.0.1` reachable. It answers the setup, then logs the demo data in `tests/e2e/store/demo-seed.json` through the UI: six earlier days of food, water and weigh-ins, today's meals, and three sets of the planned workout.
- To change what a screenshot shows, edit `demo-seed.json` (or the framing in `screenshots.mjs`) and regenerate. Look at every PNG before committing: no error banner, no placeholder text, the right screen.

## Demo data

The profile (a 30-year-old man, 165 cm, 82 kg, losing fat, six sessions a week) and every food, weight and set are invented for the screenshots. There is no real person's data in them, and the screenshots show no account, email or name.

## Licence

Only repo-owned artwork and fonts already used by the app go into these files:

- The mark is `apps/mobile/assets/brand/icon.svg` (our own artwork, #678). The feature graphic redraws the same shapes.
- Colours are `brand` `#2457E6` and white from `docs/design/DESIGN.md`.
- Type is Roboto 300 and Inter 500, both SIL Open Font License 1.1, from `@expo-google-fonts/roboto` and `@expo-google-fonts/inter` (the packages the app bundles). The font files are read from `node_modules` at export time and are not committed.
- The screenshots are of our own app. Its food, exercise and content data carries the licences in ADR 005 and the app's About screen.
- No third-party images, stock photos, device frames or other fonts. The tooling is Playwright (Apache-2.0) and Chromium (BSD-3-Clause).

Keep the graphics free of anything that appeals to children (`docs/PLAY-STORE-LISTING.md`, content rating) and of claims the app does not meet.
