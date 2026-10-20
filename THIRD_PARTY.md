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
| App icon, adaptive icon, splash and web favicon images | Own work (original artwork from `apps/mobile/assets/brand/*.svg`) | Apache-2.0 | `apps/mobile/assets/*.png` |
| Website favicon | Own work | Apache-2.0 | `apps/site/public/favicon.svg` |
| MoveNet SinglePose Lightning model weights (TensorFlow.js, version 4) | Google ([Kaggle model page](https://www.kaggle.com/models/google/movenet/TfJs/singlepose-lightning); [model card](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf)) | Apache-2.0 (the Kaggle page and the model card both say so). The model card says the training data includes a Google internal set of fitness images; the weights are licensed Apache-2.0 regardless. Files unmodified, sha256 in the licence file | `apps/mobile/public/pose/movenet-lightning/` (with `LICENSE.txt`). Used by live pose tracking on the web (#947), served from our own origin and loaded only when a user opens it |
| MoveNet SinglePose Lightning model weights (TensorFlow Lite, float16, version 1) | Google ([Kaggle model page](https://www.kaggle.com/models/google/movenet/tfLite/singlepose-lightning-tflite-float16); [model card](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf)) | Apache-2.0 (the Kaggle page and the model card both say so). The model card says the training data includes a Google internal set of fitness images; the weights are licensed Apache-2.0 regardless. File unmodified (sha256 0fac2226...dd135ab, checked on the phone before every run) | `apps/mobile/modules/plate-pose/android/src/main/assets/` (with `apps/mobile/modules/plate-pose/MODEL-LICENSE.txt`). Bundled in the Android app for live pose tracking (#947); never downloaded |
| LiteRT 1.4.0 (`com.google.ai.edge.litert:litert`, `litert-api`) and the TensorFlow Lite native library `libtensorflowlite_jni.so` | [Google AI Edge LiteRT](https://github.com/google-ai-edge/LiteRT) | Apache-2.0. The native library also contains XNNPACK, KleidiAI, ruy, gemmlowp, FlatBuffers, cpuinfo, pthreadpool, FP16, FXdiv, the Eigen thread pool, Ooura FFT, FarmHash, Abseil, NEON_2_SSE (x86 builds) and LLVM libc++; notices for each are in the app's About screen (`apps/mobile/scripts/licences.mjs`, `scripts/licence-texts/native`). Bundled runtime on the CPU: no Play services, no GPU delegate | `apps/mobile/modules/plate-pose/android/build.gradle`. Used by live pose tracking on Android (#947) |
| TensorFlow.js WebAssembly backend binaries (`tfjs-backend-wasm.wasm`, `tfjs-backend-wasm-simd.wasm`) | [TensorFlow.js](https://github.com/tensorflow/tfjs) 4.22.0 | Apache-2.0. The binaries contain XNNPACK, pthreadpool, cpuinfo (BSD), FP16, FXdiv (MIT) and the Emscripten runtime (MIT); all notices are in the licence file | `apps/mobile/public/pose/wasm/` (with `LICENSE.txt`) |
| Exercise demo photos in the prototype (removed) | Unknown. The 126 JPEGs were labelled Free Exercise DB and claimed to be Unlicense, but their provenance is unverified | Claimed to be Unlicense, but provenance is unknown; removed | Removed from `docs/prototype/plate-and-bar.html` (#653). They remain in git history. The app shows no exercise photos |
| Exercise start and end drawings (`content/exercise-images.json`) | Own work (Plate & Bar authors) | CC BY 4.0 | Shown in the Learn block; credited in About under Exercise drawings. Empty until the generated figures land (#653) |
| Exercise motion keyframes (`content/exercise-motion.json`) | Own work (Plate & Bar authors), derived from our own filmed clips with a signed model release, or from CC0, CC BY 4.0 or CC BY 3.0 clips on Wikimedia Commons only (each entry records `source_url`, retrieval date, licence and attribution). Only joint numbers are kept, never video | CC BY 4.0 (CC0 where the clip is CC0). Clips under CC0, CC BY 4.0 or CC BY 3.0 only (CC BY 3.0 permits adaptations under other terms with attribution), credited to the clip's author; share-alike (SA), NC and ND clips and YouTube are never used, so the bundle stays CC BY 4.0 as in `CONTENT-LICENSE` | No entries yet (#1069). Made by `tools/exercise-motion/` |
| MediaPipe Pose Landmarker models (BlazePose GHUM 3D, full and heavy `.task`) and the `mediapipe` Python package 1.1.1 | Google ([Pose Landmarker page](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker); [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)) | Apache-2.0 (the model card says "LICENSED UNDER Apache License, Version 2.0"; PyPI and the GitHub repository say Apache-2.0 for the package). The card says the training images include 30K consented images, and most of the 85K training images are fitness poses; the weights are licensed Apache-2.0 regardless. Files unmodified, sha256 `4eaa5eb7...ecdcec4ad` (full) and `64437af8...fcbc7b` (heavy) | Offline authoring tool only (`tools/exercise-motion/`), not in the app and not shipped; the pinned Python dependencies are listed in `tools/exercise-motion/README.md` |

The prototype (`docs/prototype/plate-and-bar.html`) also loads the Bricolage Grotesque font from Google Fonts (SIL Open Font License 1.1) and pdf.js from cdnjs (Apache-2.0) at runtime. Neither is stored in this repository.

## Dependencies not under MIT, BSD, ISC or Apache-2.0

Dependencies are installed from npm and Maven Central and are not stored in this repository. This table lists every dependency in the six npm lockfiles and in the backend's Gradle runtime and test classpaths whose licence is not MIT, BSD, ISC, 0BSD, CC0 or Apache-2.0, as of this file's last change. "Ships in" says where the dependency ends up:

- **Build or test only**: the dependency runs on a developer machine or in CI and does not end up in anything we distribute.
- **Web bundle**: the dependency is in the JavaScript bundle or assets that we serve.
- **Backend jar**: the dependency is inside the Spring Boot jar and its container image.

The website ships HTML, CSS and fonts only, with no npm JavaScript. Its build in `apps/site` (Astro) uses the `apps/site` packages below. Source maps from `npx expo export --platform web` show that the app's JavaScript bundle contains only MIT, BSD, ISC and Apache-2.0 packages, plus the OFL fonts listed above. The Android build also adds native libraries through Gradle (React Native and Expo modules). This file does not cover those libraries.

| Dependency | Licence | Used by | Ships in |
|---|---|---|---|
| [axe-core](https://github.com/dequelabs/axe-core) | MPL-2.0 (used unmodified) | Accessibility checks: `tests/e2e` (`specs/a11y.spec.mjs`), `apps/site/scripts/a11y.mjs` | Build or test only |
| `lightningcss` and its platform binaries | MPL-2.0 | CSS processing in the Astro (`apps/site`) and Expo/Metro (`apps/mobile`) builds | Build or test only |
| `@img/sharp-libvips-*`, `@img/sharp-wasm32`, `@img/sharp-win32-*` | LGPL-3.0-or-later (libvips), with Apache-2.0 and MIT parts | Optional image processing for the Astro build (`apps/site`) | Build or test only (optional; the site has no processed images) |
| `caniuse-lite` | CC-BY-4.0 | Browser data for the build tools (`apps/mobile`, `packages/core` tests) | Build or test only |
| `glob`, `jackspeak`, `lru-cache`, `minimatch`, `minipass`, `package-json-from-dist`, `path-scurry`, `sax`, `common-ancestor-path` | BlueOak-1.0.0 | Build and test tooling (`apps/mobile`, `apps/site`, `packages/core`) | Build or test only |
| `argparse` | Python-2.0 | YAML tooling (`packages/api`, `apps/mobile`) | Build or test only |
| `node-forge` | BSD-3-Clause OR GPL-2.0 (used under BSD-3-Clause) | Expo CLI dev server (`apps/mobile`) | Build or test only |
| `com.mysql:mysql-connector-j` | GPL-2.0 with the Universal FOSS Exception 1.0 | MySQL driver (`backend`) | Backend jar |
| `ch.qos.logback:logback-classic`, `logback-core` | EPL-2.0 OR LGPL-2.1 | Logging (Spring Boot default; `backend`) | Backend jar |
| `jakarta.annotation:jakarta.annotation-api`, `jakarta.mail:jakarta.mail-api`, `org.eclipse.angus:angus-mail` | EPL-2.0 OR GPL-2.0 with the Classpath Exception | Spring and sign-in code email (`backend`) | Backend jar |
| `jakarta.activation:jakarta.activation-api`, `org.eclipse.angus:angus-activation` | EDL 1.0 (BSD-3-Clause) | Email (`backend`) | Backend jar |
| JUnit (`org.junit.*`, `junit:junit`) | EPL-2.0 (JUnit 5/6), EPL-1.0 (JUnit 4, through Testcontainers) | Backend tests | Build or test only |
| `net.java.dev.jna:jna` | LGPL-2.1-or-later OR Apache-2.0 (used under Apache-2.0) | Testcontainers (`backend` tests) | Build or test only |
| `jakarta.xml.bind:jakarta.xml.bind-api`, `org.eclipse.angus:jakarta.mail` | EDL 1.0; EPL-2.0 OR GPL-2.0 with the Classpath Exception | GreenMail (`backend` tests) | Build or test only |

The Gradle wrapper (`backend/gradlew`, `backend/gradlew.bat`, `backend/gradle/wrapper/gradle-wrapper.jar`) is Apache-2.0, Copyright 2015 the original authors.

Check the licence before adding any dependency, data source or image, and add a row here if it is not MIT, BSD, ISC, 0BSD, CC0 or Apache-2.0.
