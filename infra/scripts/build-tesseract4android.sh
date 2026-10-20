#!/usr/bin/env bash
# Builds the Tesseract4Android release AAR from a pinned upstream commit and lays it out as a Maven repository (#1067, ADR 010).
# The AAR is vendored in apps/mobile/modules/plate-label-scanner/android/libs-maven/, so no build resolves it from JitPack (whose
# rebuild of the 4.9.0 tag failed after upstream moved the tag) and nothing about it can change under us.
#
#   infra/scripts/build-tesseract4android.sh [<output-dir>]
#
# Needs git, JDK 21 (the script refuses any other major version: it decides the bytecode of classes.jar), and an Android SDK ($ANDROID_HOME) with NDK 27.1.12297006 (the NDK React Native pins, the one the app's
# own native build uses) and CMake 3.22.1. Upstream's AGP (8.10.1) and Gradle (8.11.1) are used as upstream pins them: its build
# script is written for that AGP and does not work with the app's AGP 9. Only ndkVersion is changed, from upstream's 27.2.12479018.
# Output: <output-dir>/app/plateandbar/vendor/tesseract4android/4.9.0/tesseract4android-4.9.0.{aar,pom}; the default output-dir is the vendored folder.
# The sha256 of the AAR is printed. The build is meant to be reproducible: the zip entries carry fixed timestamps, and the compilers get
# -ffile-prefix-map / -fmacro-prefix-map so the random temporary source directory is not compiled into the libraries as __FILE__ strings
# (that was what made two builds differ). The vendored file's hash is still what CI checks; CI does not rebuild.
# The group is our own, app.plateandbar.vendor: upstream's group cz.adaptech is one JitPack answers for (with a POM pointing at its own build), which
# the Expo template's unfiltered jitpack.io entry would then serve instead of this file.
set -euo pipefail

COMMIT=d7de990ef78f70d553e327b98b3992d11863f134   # "Fix CMake build", 2025-06-11, the last commit before the 4.9.0 release was published (the tag has since moved to 15c5347)
NDK=27.1.12297006
JDK_MAJOR=21
# Official Gradle 8.11.1 checksums (https://gradle.org/release-checksums/): the -all distribution zip and gradle-wrapper.jar.
GRADLE_DIST_SHA256=89d4e70e4e84e2d2dfbb63e4daa53e21b25017cc70c37e4eea31ee51fb15098a   # gradle-8.11.1-all.zip, the distribution upstream names
GRADLE_WRAPPER_JAR_SHA256=2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046
VERSION=4.9.0
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/../../apps/mobile/modules/plate-label-scanner/android/libs-maven}"
: "${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}"

jdk="$(java -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')"
[ "$jdk" = "$JDK_MAJOR" ] || { echo "needs JDK $JDK_MAJOR, found ${jdk:-none}" >&2; exit 1; }

work="$(cd "$(mktemp -d)" && pwd -P)"   # physical path, so the prefix maps below match what the compiler sees
trap 'rm -rf "$work"' EXIT
git clone -q https://github.com/adaptech-cz/Tesseract4Android.git "$work/src"
cd "$work/src"
git checkout -q "$COMMIT"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "checked out the wrong commit" >&2; exit 1; }
sed -i.bak "s/ndkVersion \"[0-9.]*\"/ndkVersion \"$NDK\"/" tesseract4android/build.gradle
grep -q "ndkVersion \"$NDK\"" tesseract4android/build.gradle || { echo "ndkVersion not patched" >&2; exit 1; }
sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
wrapper=gradle/wrapper/gradle-wrapper.properties
# Upstream commits a gradle-wrapper.jar from 2022 that is not the Gradle 8.11.1 one, so it cannot be checked against Gradle's published value.
# Replace it with the official 8.11.1 jar and check that against the published checksum.
curl -fsSL -o gradle/wrapper/gradle-wrapper.jar https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradle/wrapper/gradle-wrapper.jar
[ "$(sha256_of gradle/wrapper/gradle-wrapper.jar)" = "$GRADLE_WRAPPER_JAR_SHA256" ] || { echo "gradle-wrapper.jar checksum mismatch" >&2; exit 1; }
grep -q 'gradle-8.11.1-all.zip' "$wrapper" || { echo "unexpected Gradle distribution in $wrapper" >&2; exit 1; }
sed -i.bak '/^distributionSha256Sum=/d' "$wrapper"
printf 'distributionSha256Sum=%s\n' "$GRADLE_DIST_SHA256" >> "$wrapper"
# Keep the random temp path out of the native code (__FILE__, assert messages, debug info). Gradle does not pass CFLAGS from the
# environment on to CMake, so the flags go into the module's cmake block, next to the argument upstream already sets there.
maps="-ffile-prefix-map=$work/src=. -fmacro-prefix-map=$work/src=. -fdebug-prefix-map=$work/src=."
sed -i.bak "s|^\([[:space:]]*\)arguments \"-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON\"|&\n\1cFlags \"$maps\"\n\1cppFlags \"$maps\"|" tesseract4android/build.gradle
[ "$(grep -c -- '-ffile-prefix-map' tesseract4android/build.gradle)" = 2 ] || { echo "prefix-map flags not added" >&2; exit 1; }
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
