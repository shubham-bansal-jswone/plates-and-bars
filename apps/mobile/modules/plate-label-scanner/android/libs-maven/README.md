# Vendored Tesseract4Android 4.9.0 (#1067, ADR 010)

A module-local Maven repository holding one artifact: `app.plateandbar.vendor:tesseract4android:4.9.0` (our own group; upstream's `cz.adaptech` is one JitPack answers for, and the Expo template's unfiltered jitpack.io entry would serve that instead of this file) (Apache-2.0), the standard release AAR of
Tesseract 5.5.1 with Leptonica 1.85.0, libjpeg 9f and libpng 1.6.48 (the upstream README for 4.9.0 names these versions).

| | |
|---|---|
| Source | https://github.com/adaptech-cz/Tesseract4Android at commit `d7de990ef78f70d553e327b98b3992d11863f134` ("Fix CMake build", 2025-06-11) |
| Why that commit | The last commit before the 4.9.0 release was published (2025-06-11); the upstream tag `4.9.0` has since moved to `15c5347`, and JitPack could not rebuild it. The commit before it, `97d82e6` ("Release version 4.9.0"), does not build with CMake. |
| Build | `infra/scripts/build-tesseract4android.sh`, run on 2026-10-20 with JDK 21 (the script refuses any other major version). Upstream's AGP 8.10.1 and Gradle 8.11.1 (the script checks the official `-all` distribution sha256 and replaces upstream's 2022 `gradle-wrapper.jar`, which is not Gradle's 8.11.1 one, with the official jar, checked against Gradle's published sha256), NDK 27.1.12297006 (the app's own NDK; upstream names 27.2.12479018), CMake 3.22.1, `:tesseract4android:assembleStandardRelease` |
| File | `app/plateandbar/vendor/tesseract4android/4.9.0/tesseract4android-4.9.0.aar`, 12,847,921 bytes |
| sha256 | `783b1a4ca5dfdcc4d4a6847fbfcedd24728d388e9657ec59531bfd5bf4d67352` |
| Checked by | `VendoredAarTest.kt` (`:plate-label-scanner:testDebugUnitTest`) and `__tests__/label-ocr-assets.test.ts`, both in CI |
| 16 KB pages | Every LOAD segment of the arm64-v8a and x86_64 libraries is aligned to 0x4000 (the 32-bit ones are 0x1000) |

The build is reproducible: two builds from scratch on 2026-10-20 gave this same hash. The zip entries carry fixed timestamps, and the script passes `-ffile-prefix-map` and `-fmacro-prefix-map` for the temporary source directory, so no builder path is compiled into the libraries as `__FILE__` strings (before that, every rebuild differed because of them; no `/var/folders` or `/private/var` path remains in the `.so` files). Other toolchain versions (another JDK major, NDK or CMake) can still give a different hash. CI pins this file's hash and does not rebuild it. To update it, run the script, then update the hash in
`build.gradle`, `VendoredAarTest.kt`, the jest test, the licence row in `apps/mobile/scripts/licences.mjs` and this file.
The `.pom` is written by the script: one runtime dependency, `androidx.annotation:annotation:1.3.0`, as upstream.
