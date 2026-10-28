// Local Expo config plugin: no unfiltered JitPack repository in the generated Android project. #1079.
// The Expo template adds maven { url 'https://www.jitpack.io' } to allprojects, and the React Native Gradle plugin adds
// its own JitPack entry unless react.includeJitpackRepository is false. An unfiltered JitPack lets any dependency of any
// module resolve from it, so the per-module includeGroup limits (the vendored Tesseract4Android repository in
// modules/plate-label-scanner) would not isolate anything. Nothing in this app needs JitPack: the one dependency that
// came from there (Tesseract4Android) is vendored, see infra/scripts/build-tesseract4android.sh.
const { withProjectBuildGradle, withGradleProperties } = require('expo/config-plugins');

const GRADLE_PROPERTY = 'react.includeJitpackRepository';
// One maven { ... } line pointing at jitpack.io, in either quote style, with or without www.
const JITPACK_LINE = /^[ \t]*maven\s*\{\s*url\s*(?:=\s*)?(?:uri\()?\s*['"]https?:\/\/(?:www\.)?jitpack\.io\/?['"]\s*\)?\s*\}[ \t]*\r?\n?/gm;

/** Removes the template's JitPack repository lines. Idempotent. */
function removeJitpack(source) {
  return source.replace(JITPACK_LINE, '');
}

function withNoJitpack(config) {
  config = withProjectBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') throw new Error('with-no-jitpack: expected a Groovy android/build.gradle.');
    c.modResults.contents = removeJitpack(c.modResults.contents);
    // A template change we do not recognise must fail prebuild, not bring JitPack back silently.
    if (/jitpack/i.test(c.modResults.contents)) {
      throw new Error('with-no-jitpack: android/build.gradle still mentions JitPack after removal; the Expo template changed, update the plugin.');
    }
    return c;
  });
  return withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key === GRADLE_PROPERTY));
    c.modResults.push({ type: 'property', key: GRADLE_PROPERTY, value: 'false' });
    return c;
  });
}

module.exports = withNoJitpack;
module.exports.GRADLE_PROPERTY = GRADLE_PROPERTY;
module.exports.removeJitpack = removeJitpack;
