# Third-party data and assets

Plate & Bar code is licensed under Apache-2.0 ([LICENSE](LICENSE)) and our own written content under CC BY 4.0 ([CONTENT-LICENSE](CONTENT-LICENSE)). The data and assets below are not ours: each keeps its own licence, and anyone reusing them must follow that licence, not ours.

## Food data

Every row in `content/foods.json`, `content/raw-ingredients.json` and `content/eatout.json` records its source and licence in a `source` field (ADR 002 and ADR 005), and the app's About screen lists them (`apps/mobile/src/about/sources.ts`).

| Source code | Source | Licence or basis | Where |
|---|---|---|---|
| `usda_fdc` | [USDA FoodData Central](https://fdc.nal.usda.gov/) (SR Legacy), U.S. Department of Agriculture, Agricultural Research Service | Public domain (CC0 1.0) | `content/foods.json`, `content/raw-ingredients.json`; also the per-row "values match USDA" notes |
| `fssai` | Values derived from FSSAI composition standards | Values calculated by us from published standards; no table copied | `content/foods.json`, `content/raw-ingredients.json` |
| `label_typical` | Typical label values for packaged foods | Nutrition facts read from product labels; no label database copied | `content/foods.json`, `content/raw-ingredients.json` |
| `own_recipe` | Plate & Bar home recipes, calculated by weight from the ingredient values above | Own work (CC BY 4.0) | `content/foods.json`, `content/recipes.json` |
| `own_estimate` | Plate & Bar own estimates (generic mixes, typical restaurant portions; not weighed) | Own work (CC BY 4.0) | `content/raw-ingredients.json`, `content/eatout.json` |

Adding a new food source needs its own licence check and a new ADR (ADR 005).

## Card citations

The `source` field on each card in `content/cards.json` (for example "Mifflin et al., 1990") is a reference to the study, review or position stand the card is based on. The card text is our own summary; no text from those works is copied, and the works themselves keep their publishers' copyright.

## Images, shapes and fonts

| Asset | Source | Licence | Where |
|---|---|---|---|
| Body map polygons | [react-body-highlighter](https://github.com/giavinh79/react-body-highlighter), Copyright (c) 2020 GV79, adapted | MIT. The full notice is kept in each copy and shown on the About screen (#463) | `apps/mobile/src/workout/bodyMapData.ts`, `docs/prototype/plate-and-bar.html` |
| Inter font | [The Inter Project Authors](https://github.com/rsms/inter) | SIL Open Font License 1.1 | App: `@expo-google-fonts/inter`, licence text in `apps/mobile/public/licenses/Inter-OFL-1.1.txt`. Site: `@fontsource/inter`, licence text in `apps/site/public/fonts/Inter-OFL.txt` |
| Roboto font | [The Roboto Project Authors](https://github.com/googlefonts/roboto-classic) | SIL Open Font License 1.1 | App: `@expo-google-fonts/roboto`, licence text in `apps/mobile/public/licenses/Roboto-OFL-1.1.txt`. Site: `@fontsource/roboto`, licence text in `apps/site/public/fonts/Roboto-OFL.txt` |
| Tab bar icons (Ionicons) | [Ionicons](https://github.com/ionic-team/ionicons) via `@expo/vector-icons` | MIT | `apps/mobile/app/(tabs)/_layout.tsx` |
| App icon, adaptive icon, splash and web favicon images | Expo project template (placeholders, to be replaced by our own artwork) | MIT ([expo/expo](https://github.com/expo/expo)) | `apps/mobile/assets/*.png` |
| Website favicon | Own work | Apache-2.0 | `apps/site/public/favicon.svg` |
| Exercise demo photos in the prototype | [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) | Public domain (The Unlicense) | `docs/prototype/plate-and-bar.html` only; the app shows no exercise photos |

The prototype (`docs/prototype/plate-and-bar.html`) also loads the Bricolage Grotesque font from Google Fonts (SIL Open Font License 1.1) and pdf.js from cdnjs (Apache-2.0) at runtime. Neither is stored in this repository.

## Tools used in tests and builds

These are dependencies, not shipped in the app or the website. They are listed here because their licence is not MIT, BSD, ISC or Apache-2.0.

| Package | Licence | Where |
|---|---|---|
| [axe-core](https://github.com/dequelabs/axe-core) | MPL-2.0 (accepted as open source; used unmodified) | Accessibility checks: `tests/e2e` (`specs/a11y.spec.mjs`) and `apps/site/scripts/a11y.mjs` |

The Gradle wrapper (`backend/gradlew`, `backend/gradlew.bat`, `backend/gradle/wrapper/gradle-wrapper.jar`) is Apache-2.0, Copyright 2015 the original authors.

All other npm and Gradle dependencies are installed from their registries under their own licences and are not stored in this repository. Check the licence before adding any dependency, data source or image.
