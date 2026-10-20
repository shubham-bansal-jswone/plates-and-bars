# Vendored Tesseract4Android 4.9.0 (#1067, ADR 010)

A module-local Maven repository holding one artifact: `app.plateandbar.vendor:tesseract4android:4.9.0` (our own group; upstream's `cz.adaptech` is one JitPack answers for, and the Expo template's unfiltered jitpack.io entry would serve that instead of this file) (Apache-2.0), the standard release AAR of
Tesseract 5.5.1 with Leptonica 1.85.0, libjpeg 9f and libpng 1.6.48 (the upstream README for 4.9.0 names these versions).

| | |
|---|---|
| Source | https://github.com/adaptech-cz/Tesseract4Android at commit `d7de990ef78f70d553e327b98b3992d11863f134` ("Fix CMake build", 2025-06-11) |
| Why that commit | The last commit before the 4.9.0 release was published (2025-06-11); the upstream tag `4.9.0` has since moved to `15c5347`, and JitPack could not rebuild it. The commit before it, `97d82e6` ("Release version 4.9.0"), does not build with CMake. |
| Build | `infra/scripts/build-tesseract4android.sh`, run on 2026-10-20. Upstream's AGP 8.10.1 and Gradle 8.11.1, NDK 27.1.12297006 (the app's own NDK; upstream names 27.2.12479018), CMake 3.22.1, `:tesseract4android:assembleStandardRelease` |
| File | `app/plateandbar/vendor/tesseract4android/4.9.0/tesseract4android-4.9.0.aar`, 12,850,019 bytes |
| sha256 | `e6226ad06b34aaf4ab4f642d2b8e40fa86172e84bd4e5fc9066d2217472bc78a` |
| Checked by | `VendoredAarTest.kt` (`:plate-label-scanner:testDebugUnitTest`) and `__tests__/label-ocr-assets.test.ts`, both in CI |
| 16 KB pages | Every LOAD segment of the arm64-v8a and x86_64 libraries is aligned to 0x4000 (the 32-bit ones are 0x1000) |

The AAR is not byte-reproducible (zip timestamps), so CI pins this file's hash and does not rebuild it. To update it, run the script, then update the hash in
`build.gradle`, `VendoredAarTest.kt`, the jest test, the licence row in `apps/mobile/scripts/licences.mjs` and this file.
The `.pom` is written by the script: one runtime dependency, `androidx.annotation:annotation:1.3.0`, as upstream.
