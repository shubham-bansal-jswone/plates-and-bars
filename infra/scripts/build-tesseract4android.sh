#!/usr/bin/env bash
# Builds the Tesseract4Android release AAR from a pinned upstream commit and lays it out as a Maven repository (#1067, ADR 010).
# The AAR is vendored in apps/mobile/modules/plate-label-scanner/android/libs-maven/, so no build resolves it from JitPack (whose
# rebuild of the 4.9.0 tag failed after upstream moved the tag) and nothing about it can change under us.
#
#   infra/scripts/build-tesseract4android.sh [<output-dir>]
#
# Needs git, JDK 17 or 21, and an Android SDK ($ANDROID_HOME) with NDK 27.1.12297006 (the NDK React Native pins, the one the app's
# own native build uses) and CMake 3.22.1. Upstream's AGP (8.10.1) and Gradle (8.11.1) are used as upstream pins them: its build
# script is written for that AGP and does not work with the app's AGP 9. Only ndkVersion is changed, from upstream's 27.2.12479018.
# Output: <output-dir>/app/plateandbar/vendor/tesseract4android/4.9.0/tesseract4android-4.9.0.{aar,pom}; the default output-dir is the vendored folder.
# The sha256 of the AAR is printed; a different machine can give a different hash (zip timestamps), so the vendored file's hash,
# not a rebuild, is what CI checks.
# The group is our own, app.plateandbar.vendor: upstream's group cz.adaptech is one JitPack answers for (with a POM pointing at its own build), which
# the Expo template's unfiltered jitpack.io entry would then serve instead of this file.
set -euo pipefail

COMMIT=d7de990ef78f70d553e327b98b3992d11863f134   # "Fix CMake build", 2025-06-11, the last commit before the 4.9.0 release was published (the tag has since moved to 15c5347)
NDK=27.1.12297006
VERSION=4.9.0
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/../../apps/mobile/modules/plate-label-scanner/android/libs-maven}"
: "${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone -q https://github.com/adaptech-cz/Tesseract4Android.git "$work/src"
cd "$work/src"
git checkout -q "$COMMIT"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "checked out the wrong commit" >&2; exit 1; }
sed -i.bak "s/ndkVersion \"[0-9.]*\"/ndkVersion \"$NDK\"/" tesseract4android/build.gradle
grep -q "ndkVersion \"$NDK\"" tesseract4android/build.gradle || { echo "ndkVersion not patched" >&2; exit 1; }
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > local.properties
./gradlew --no-daemon -q :tesseract4android:assembleStandardRelease

aar="$(ls tesseract4android/build/outputs/aar/tesseract4android-standard-release.aar)"
dest="$out/app/plateandbar/vendor/tesseract4android/$VERSION"
mkdir -p "$dest"
cp "$aar" "$dest/tesseract4android-$VERSION.aar"
cat > "$dest/tesseract4android-$VERSION.pom" <<POM
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>app.plateandbar.vendor</groupId>
  <artifactId>tesseract4android</artifactId>
  <version>$VERSION</version>
  <packaging>aar</packaging>
  <name>Tesseract4Android</name>
  <url>https://github.com/adaptech-cz/Tesseract4Android</url>
  <licenses><license><name>Apache-2.0</name><url>https://www.apache.org/licenses/LICENSE-2.0</url></license></licenses>
  <dependencies>
    <dependency>
      <groupId>androidx.annotation</groupId>
      <artifactId>annotation</artifactId>
      <version>1.3.0</version>
      <scope>runtime</scope>
    </dependency>
  </dependencies>
</project>
POM
echo "built from $COMMIT with NDK $NDK"
shasum -a 256 "$dest/tesseract4android-$VERSION.aar"
