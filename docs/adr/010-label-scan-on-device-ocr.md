# ADR 010: Label scanning: on-device OCR with Tesseract, mandatory review, no server call

- Status: Accepted
- Date: 2026-10-19
- Issue: #1067 (spike and decision)
- Decided on #1067 by the coordinator under the owner's delegation. No `openapi.yaml` change.

## Context

v2 adds label scanning: the user photographs the nutrition table on a pack and the app proposes a food to review. Barcode lookup (ADR 009) cannot cover products that are not in Open Food Facts, and many Indian packs are not.

OCR can be wrong in ways that look right, and a label photo is a camera image, so privacy matters as it did in ADR 008. The project is open-source only: no proprietary dependency, no vendor terms. The spike on #1067 compared the options. Figures it marked "estimate" are not measured and are checked in the bake-off below.

Alternatives considered:

- **PP-OCRv5 through ONNX Runtime first.** Better on curved and glossy scene text, but two networks, more code and a larger download (models about 12.5 MB, plus the runtime), and slower on CPU in the one benchmark found. Kept as the fallback.
- **PaddleOCR through ncnn or MNN (RapidOCR).** Smaller runtime, but more native build work and an unread per-model licence file. Second fallback.
- **LiteRT with a converted OCR model.** The runtime ships already for pose tracking, but no maintained, licence-clean printed-text model was found.
- **tess-two.** Archived in 2022. **EasyOCR and docTR.** PyTorch based, with no maintained Android build.
- **Google ML Kit, Play services, cloud OCR or an AI vision call.** Out by the open-source-only rule, and a cloud path would send the photo off the phone.
- **Live-video OCR.** Less accurate and less private than one framed, user-confirmed still.

## Decision

1. **Engine: Tesseract 5 on both platforms.** Android uses Tesseract4Android 4.9.0 (Tesseract 5.5.1) in a new module `plate-label-scanner`, next to `plate-barcode-scanner`. Web uses tesseract.js. Both read `tessdata_fast` `eng.traineddata` (4.1 MB). Engine code and data are Apache-2.0; the bundled image libraries (Leptonica, libjpeg, libpng) are under other permissive licences, see Consequences. One parser in `packages/core` serves both, so Android and web read a label the same way.
2. **Fallback: PP-OCRv5 mobile through ONNX Runtime**, used only if Tesseract fails the accuracy gate. The parser and the screens do not change. It needs its own size decision and a read of the upstream `LICENSE` and model licences first.
3. **Not ML Kit, Play services or any cloud OCR.** They are proprietary, which the open-source-only rule forbids.
4. **On-device only.** No backend call, no AI call and no fallback to either. The photo and the OCR run on the phone or in the browser. The image stays in memory: never written to disk, sent, logged or added to progress photos, and dropped when the screen closes. ADR 008's image path is not used. Crash and error reports carry neither the image nor the recognised text.
5. **Review is mandatory.** There is no path from the camera to a saved food that skips the review screen, and no auto-add. Add stays disabled until the name, kcal, protein, carbs and fat are set. Fields read with low confidence start empty, and medium or low fields carry a text marker. There is no "trust me" setting.
6. **Scope of slice 1.** Still photo with a crop step, not live video. English only, no Hindi: FSSAI panels are printed in English. No sodium or salt: the food model has no field for it, and adding one is a separate contract change. Android arm64 and web; no iOS. Per 100 g is the default when both columns are read, and the review screen offers a "Use per serving instead" switch.
7. **Size.** At most 8 MB added on Android arm64 (Tesseract native libraries plus `eng`). If the measured size is over 8 MB, stop and report. On web, the WASM core, worker and traineddata are self-hosted on our own origin (never a CDN) and loaded only when the user opens Scan label, not at start.
8. **Flag.** `EXPO_PUBLIC_LABEL_SCAN`, build time, off by default, read by `labelScanEnabled()`, following the barcode and pose flag pattern. Off means no Add-sheet button, no route and no model bytes loaded.
9. **Bake-off before the flag goes on.** Run the engine through the parser on 40 to 60 owner-supplied photos of real Indian and US labels (mixed light, a few curved packs) on one low-end Android phone. Pass if at least 85% of the required fields (kcal, protein, carbs, fat) are exactly right or empty and flagged, no more than 3% are wrong and unflagged, the median read is under 3 s, and the size is within budget. On a fail, switch to the fallback and measure again. The gate also covers web, on the same photos: median tesseract.js OCR time on Android Chrome on the same phone and on a mid-range laptop, and the on-demand download size. The photos are test inputs only and are not committed to the repo. Before the flag goes on, the result is posted as a comment on #1067 with per-field accuracy scores, the device model, the median OCR time, the measured APK size per ABI, and the two web figures above.

## Consequences

- No `openapi.yaml` change and no backend work. A saved result is a normal `UserFood`, which already syncs.
- **16 KB page size.** Play enforces 16 KB page alignment for current targets and the Tesseract4Android documentation does not say whether its native libraries meet it. The app lane checks the ELF alignment of every library before the module merges. If they fail, the options are a rebuilt or patched library, or moving to the fallback.
- Leptonica, libjpeg and libpng come with the engine and need entries in the third-party notices, with Tesseract. `docs/PLAY-DATA-SAFETY.md` and the privacy page get a line saying photos are read on the phone and not collected.
- Accuracy is unproven on nutrition tables: no public benchmark exists. The bake-off gate, the crop step and the mandatory review are the controls, and a hurried user can still accept a wrong number. The flag stays off until the gate passes.
- Rotated, curved or two-language packs will often fail. Every failure offers typing the values, or barcode scan.
- The standard Tesseract4Android build is single-threaded. The OpenMP variant is faster but is a different build to check.
- Tests must show that no network request is made during a scan, that Add stays disabled until review, and that low-confidence fields start empty.
- Adding sodium, Hindi or iOS later is a new decision. Sodium is also a contract change.
