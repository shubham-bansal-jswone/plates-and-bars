// Local Expo config plugin: R8 keep rules the generated Android project needs. #1435.
// The Expo SDK 58 template turns on minification for release builds (android.enableMinifyInReleaseBuilds=true in the
// generated gradle.properties), so app/proguard-rules.pro is the only place to keep a reflective API alive.
//
// androidx.work (WorkManager) is shipped by react-native-android-widget's android/build.gradle, whether or not the
// widget flag is on: the plugin only skips the widget XML, never the library's native code. WorkManager initialises
// itself through androidx.startup at every launch and creates its Room database, and Room finds the generated
// *_Impl class by name. R8 renames androidx.room.*, so that lookup fails, RoomDatabase.Builder.build() throws while
// Android installs androidx.startup.InitializationProvider, and the process dies before any JavaScript runs. It only
// happens in a release build, and CI builds the APK without launching it, so nothing caught it before #1435.
//
// The rules are unconditional: the packages are in the APK either way (flag on or off), and keeping two androidx
// packages costs a few KB next to the native libraries.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** First line of the block; its presence means the rules are already applied, so prebuild stays idempotent. */
const MARKER = '# plate-and-bar: androidx.work / androidx.room (R8, #1435)';

const RULES = `${MARKER}
# WorkManager (react-native-android-widget's dependency) starts at launch and opens its Room database.
# Room instantiates the generated <Database>_Impl class by name and reads the database class's canonical name,
# both of which R8 breaks when it renames androidx.room / androidx.work. Keep both packages (not just the
# database class) so the reflective lookup resolves whatever WorkManager version the widget library pins.
-keep class androidx.work.** { *; }
-keep class androidx.room.** { *; }`;

/**
 * Appends the keep rules to a proguard-rules.pro body, once. Existing rules (and the template's comments) are
 * kept as they are, and a file that already has the block is returned unchanged so a second prebuild is a no-op.
 */
function applyKeepRules(contents) {
  if (contents.includes(MARKER)) return contents;
  const base = contents === '' || contents.endsWith('\n') ? contents : `${contents}\n`;
  return `${base}\n${RULES}\n`;
}

/** Writes the rules into the generated android/app/proguard-rules.pro after the template has been copied. */
function withR8KeepRules(config) {
  return withDangerousMod(config, [
    'android',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const before = fs.readFileSync(file, 'utf8');
      const after = applyKeepRules(before);
      if (after !== before) fs.writeFileSync(file, after);
      return c;
    },
  ]);
}

module.exports = withR8KeepRules;
module.exports.MARKER = MARKER;
module.exports.RULES = RULES;
module.exports.applyKeepRules = applyKeepRules;
