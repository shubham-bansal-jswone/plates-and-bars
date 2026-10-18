// Builds src/about/licences.json: the open-source licences shown on the About screen.
//
//   node scripts/licences.mjs                    regenerate (needs `npm ci` first)
//   node scripts/licences.mjs --check            exit 1 if the committed file is stale (CI; also run by __tests__/licences-script.test.ts)
//   node scripts/licences.mjs --classpath <file> exit 1 if <file>, the classpath a release build resolved, names an artifact with
//                                                no licence row or differs from scripts/android-classpath.txt (android-release.yml)
//   node scripts/licences.mjs --native-libs <file> exit 1 if <file>, the .so file names of the built release APK, differs from
//                                                scripts/android-native-libs.txt (android-release.yml)
//
// Sources, with no new dependency:
//   - npm: every package in package-lock.json that is not dev-only, read from node_modules (name, version, licence, notice text).
//     Optional-only entries and entries restricted to an os or cpu (platform binaries such as lightningcss-darwin-arm64, fsevents, wasm fallbacks) are left out so the file
//     is the same on every machine; they are build tools, not part of the app.
//   - Android: the Maven libraries of the release build, as Gradle resolved them (scripts/android-classpath.txt, committed so this
//     runs without an Android build), each with a licence from the ANDROID_LICENCES table and any NOTICE file it ships.
//   - Native code: third-party C and C++ compiled into the .so files of the release build (scripts/android-native-libs.txt), each with
//     a notice from the NATIVE table below. A .so with no entry in NATIVE_SO fails the script.
//   - Assets: the bundled fonts (public/licenses) and Ionicons.
// Output is deterministic (sorted, no dates).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'src/about/licences.json');
const nm = join(root, 'node_modules');
const check = process.argv.includes('--check');
const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));

if (!existsSync(nm)) { console.error('node_modules is missing: run `npm ci` first'); process.exit(1); }

const texts = {};
const textId = (text) => {
  const t = text.replace(/\r\n/g, '\n').trim();
  const id = createHash('sha256').update(t).digest('hex').slice(0, 12);
  texts[id] = t;
  return id;
};

// The licence file, plus the NOTICE file if there is one (Apache-2.0 section 4(d) asks for it to be reproduced).
const noticeFile = (dir) => {
  const names = readdirSync(dir);
  const pick = (re) => names.filter((n) => re.test(n)).sort()[0];
  const lic = pick(/^(licen[sc]e|copying|unlicen[sc]e)(\.(md|txt|markdown))?$/i);
  const notice = pick(/^notice(\.(md|txt|markdown))?$/i);
  if (!lic && !notice) return null;
  return [lic && read(join(dir, lic)), notice && `NOTICE\n\n${read(join(dir, notice))}`].filter(Boolean).join('\n\n');
};
const repoUrl = (r) => {
  const u = typeof r === 'string' ? r : r?.url;
  if (!u) return null;
  return u.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/^github:/, 'https://github.com/').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^([\w-]+\/[\w.-]+)$/, 'https://github.com/$1');
};
const licenceOf = (p) => (typeof p.license === 'string' ? p.license : p.license?.type ?? (p.licenses ?? []).map((l) => l.type ?? l).join(' OR '));

// npm packages
const lock = readJson(join(root, 'package-lock.json')).packages;
const npm = new Map();
const missing = [];
const stale = [];
const dirOf = new Map(); // name@version -> directory (not written to the output)
for (const [path, e] of Object.entries(lock)) {
  if (!path || e.dev || e.optional || e.os || e.cpu) continue;
  // A link inside this app (the @sentry/cli stub) is listed from its target; links to other workspaces packages are our own code.
  const target = e.link ? e.resolved : path;
  if (!target || target.startsWith('..') || (!e.link && !path.includes('node_modules/'))) continue;
  if (e.link && !target.startsWith('stubs/')) continue;
  const dir = join(root, target);
  if (!existsSync(join(dir, 'package.json'))) { missing.push(path); continue; }
  const p = readJson(join(dir, 'package.json'));
  if (!e.link && e.version && p.version !== e.version) { stale.push(`${p.name} ${p.version} installed, ${e.version} in the lockfile`); continue; }
  const licence = licenceOf(p) || e.license;
  if (!licence) { console.error(`no licence recorded for ${p.name}@${p.version}`); process.exit(1); }
  const text = noticeFile(dir);
  dirOf.set(`${p.name}@${p.version}`, dir);
  npm.set(`${p.name}@${p.version}`, { name: p.name, version: p.version, licence, url: repoUrl(p.repository) ?? p.homepage ?? null, text: text ? textId(text) : null });
}
if (stale.length) { console.error(`node_modules does not match package-lock.json (run npm ci): ${stale.slice(0, 5).join('; ')}`); process.exit(1); }
if (missing.length) { console.error(`not installed (run npm ci): ${missing.slice(0, 5).join(', ')}`); process.exit(1); }
const packages = [...npm.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

// Android libraries
// The resolved release classpath (scripts/android-classpath.txt, written by scripts/android-classpath.init.gradle; see there for
// how to regenerate it). Every artifact, at its exact version, needs a row in ANDROID_LICENCES below, checked against its POM and
// project (2026-10-18): an artifact or version without one fails the script with its name, so the table is completed on purpose
// and never guessed.
// Licence texts attached to every row (the licences require the text, with its copyright notice, to accompany the work).
// Apache-2.0 names no holder, so one standard text taken from an installed npm package serves for all. MIT and BSD texts carry a
// copyright line, so each such artifact names its upstream LICENSE copied into scripts/licence-texts/.
// NOTICE files the artifacts ship are listed in the classpath file by hash and copied to scripts/licence-texts/notice-<hash>.txt.
const apacheText = [...npm.values()].map((e) => ({ e, t: noticeFile(dirOf.get(`${e.name}@${e.version}`)) })).find(({ e, t }) => e.licence === 'Apache-2.0' && t?.includes('Version 2.0, January 2004'))?.t;
if (!apacheText) { console.error('no Apache-2.0 licence text found among the npm packages'); process.exit(1); }
const SPDX_TEXT = { 'Apache-2.0': apacheText.split('\n\nNOTICE\n\n')[0] };
const LICENCE_URL = {
  'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
  MIT: 'https://opensource.org/license/mit',
  'BSD-2-Clause': 'https://opensource.org/license/bsd-2-clause',
  'BSD-3-Clause': 'https://opensource.org/license/bsd-3-clause',
};
// [group, licence (SPDX ids, plus Bolts' patent grant by name), upstream licence text in scripts/licence-texts or null, artifact@version for each artifact in that group].
// The version is the one whose POM and LICENSE were checked: a new version fails until someone re-checks it and updates the row.
const ANDROID_LICENCES = [
  ['androidx.activity', 'Apache-2.0', null, 'activity@1.11.0 activity-ktx@1.11.0'],
  ['androidx.annotation', 'Apache-2.0', null, 'annotation@1.9.1 annotation-experimental@1.4.1 annotation-jvm@1.9.1'],
  ['androidx.appcompat', 'Apache-2.0', null, 'appcompat@1.7.1 appcompat-resources@1.7.1'],
  ['androidx.arch.core', 'Apache-2.0', null, 'core-common@2.2.0 core-runtime@2.2.0'],
  ['androidx.autofill', 'Apache-2.0', null, 'autofill@1.3.0'],
  ['androidx.biometric', 'Apache-2.0', null, 'biometric@1.1.0'],
  // CameraX for the barcode scanner (#944). camera-core's POM names Apache-2.0 and BSD (libyuv, in libimage_processing_util_jni.so; see NATIVE below).
  ['androidx.camera', 'Apache-2.0 AND BSD-3-Clause', 'libyuv.txt', 'camera-core@1.5.2'],
  ['androidx.camera', 'Apache-2.0', null, 'camera-camera2@1.5.2 camera-lifecycle@1.5.2 camera-video@1.5.2 camera-view@1.5.2'],
  ['androidx.camera.featurecombinationquery', 'Apache-2.0', null, 'featurecombinationquery@1.5.2'],
  ['androidx.cardview', 'Apache-2.0', null, 'cardview@1.0.0'],
  ['androidx.collection', 'Apache-2.0', null, 'collection@1.4.4 collection-jvm@1.4.4 collection-ktx@1.4.4'],
  ['androidx.concurrent', 'Apache-2.0', null, 'concurrent-futures@1.1.0 concurrent-futures-ktx@1.1.0'],
  ['androidx.constraintlayout', 'Apache-2.0', null, 'constraintlayout@2.1.0 constraintlayout-core@1.0.0'],
  ['androidx.coordinatorlayout', 'Apache-2.0', null, 'coordinatorlayout@1.2.0'],
  ['androidx.core', 'Apache-2.0', null, 'core@1.18.0 core-ktx@1.18.0 core-splashscreen@1.2.0 core-viewtree@1.0.0'],
  ['androidx.cursoradapter', 'Apache-2.0', null, 'cursoradapter@1.0.0'],
  ['androidx.customview', 'Apache-2.0', null, 'customview@1.1.0'],
  ['androidx.databinding', 'Apache-2.0', null, 'viewbinding@8.5.2'],
  ['androidx.documentfile', 'Apache-2.0', null, 'documentfile@1.1.0'],
  ['androidx.drawerlayout', 'Apache-2.0', null, 'drawerlayout@1.1.1'],
  ['androidx.dynamicanimation', 'Apache-2.0', null, 'dynamicanimation@1.1.0'],
  ['androidx.emoji2', 'Apache-2.0', null, 'emoji2@1.3.0 emoji2-views-helper@1.3.0'],
  ['androidx.exifinterface', 'Apache-2.0', null, 'exifinterface@1.4.1'],
  ['androidx.fragment', 'Apache-2.0', null, 'fragment@1.8.9 fragment-ktx@1.8.9'],
  ['androidx.graphics', 'Apache-2.0', null, 'graphics-shapes@1.0.1 graphics-shapes-android@1.0.1'],
  ['androidx.interpolator', 'Apache-2.0', null, 'interpolator@1.0.0'],
  ['androidx.lifecycle', 'Apache-2.0', null, 'lifecycle-common@2.6.2 lifecycle-common-java8@2.6.2 lifecycle-livedata@2.6.2 lifecycle-livedata-core@2.6.2 lifecycle-livedata-core-ktx@2.6.2 lifecycle-process@2.6.2 lifecycle-runtime@2.6.2 lifecycle-runtime-ktx@2.6.2 lifecycle-viewmodel@2.6.2 lifecycle-viewmodel-ktx@2.6.2 lifecycle-viewmodel-savedstate@2.6.2'],
  ['androidx.loader', 'Apache-2.0', null, 'loader@1.0.0'],
  ['androidx.profileinstaller', 'Apache-2.0', null, 'profileinstaller@1.4.0'],
  ['androidx.recyclerview', 'Apache-2.0', null, 'recyclerview@1.2.1'],
  ['androidx.resourceinspection', 'Apache-2.0', null, 'resourceinspection-annotation@1.0.1'],
  ['androidx.savedstate', 'Apache-2.0', null, 'savedstate@1.2.1 savedstate-ktx@1.2.1'],
  ['androidx.startup', 'Apache-2.0', null, 'startup-runtime@1.1.1'],
  ['androidx.swiperefreshlayout', 'Apache-2.0', null, 'swiperefreshlayout@1.1.0'],
  ['androidx.tracing', 'Apache-2.0', null, 'tracing@1.2.0 tracing-ktx@1.2.0'],
  ['androidx.transition', 'Apache-2.0', null, 'transition@1.7.0 transition-ktx@1.7.0'],
  ['androidx.vectordrawable', 'Apache-2.0', null, 'vectordrawable@1.1.0 vectordrawable-animated@1.1.0'],
  ['androidx.versionedparcelable', 'Apache-2.0', null, 'versionedparcelable@1.1.1'],
  ['androidx.viewpager', 'Apache-2.0', null, 'viewpager@1.0.0'],
  ['androidx.viewpager2', 'Apache-2.0', null, 'viewpager2@1.0.0'],
  ['androidx.window', 'Apache-2.0', null, 'window@1.5.1 window-core@1.5.1 window-core-android@1.5.1'],
  ['com.abovevacant', 'MIT', 'epitaph.txt', 'epitaph@0.1.1'],
  ['com.facebook.fbjni', 'Apache-2.0', null, 'fbjni@0.7.0'],
  ['com.facebook.fresco', 'MIT', 'fresco.txt', 'animated-base@3.7.0 animated-drawable@3.7.0 animated-gif@3.7.0 animated-gif-lite@3.7.0 drawee@3.7.0 fbcore@3.7.0 fresco@3.7.0 imagepipeline@3.7.0 imagepipeline-base@3.7.0 imagepipeline-native@3.7.0 imagepipeline-okhttp3@3.7.0 memory-type-ashmem@3.7.0 memory-type-java@3.7.0 memory-type-native@3.7.0 middleware@3.7.0 nativeimagefilters@3.7.0 nativeimagetranscoder@3.7.0 soloader@3.7.0 ui-common@3.7.0 ui-core@3.7.0 urimod@3.7.0 vito-core@3.7.0 vito-core-common-impl@3.7.0 vito-core-impl@3.7.0 vito-core-java-impl@3.7.0 vito-drawee-support@3.7.0 vito-options@3.7.0 vito-provider@3.7.0 vito-renderer@3.7.0 vito-source@3.7.0 webpsupport@3.7.0'],
  ['com.facebook.hermes', 'MIT', 'hermes.txt', 'hermes-android@260318099.0.4'],
  ['com.facebook.infer.annotation', 'MIT', 'infer-annotation.txt', 'infer-annotation@0.18.0'],
  ['com.facebook.react', 'MIT', 'react-native.txt', 'react-android@0.88.0'],
  ['com.facebook.soloader', 'Apache-2.0', null, 'annotation@0.12.1 nativeloader@0.12.1 soloader@0.12.1'],
  ['com.facebook.yoga', 'MIT', 'yoga.txt', 'proguard-annotations@1.19.0'],
  // The POM names BSD and Apache-2.0; Glide's LICENSE is BSD-2-Clause with MIT and Apache parts for bundled third-party code.
  ['com.github.bumptech.glide', 'BSD-2-Clause AND MIT AND Apache-2.0', 'glide.txt', 'annotations@5.0.5 disklrucache@5.0.5 gifdecoder@5.0.5 glide@5.0.5'],
  // LiteRT (TensorFlow Lite) runtime for live pose tracking on Android (#947): bundled, runs on the CPU, no Play services. Both POMs and the
  // AAR's LICENSE are Apache-2.0 (checked 2026-10-19); the AAR carries libtensorflowlite_jni.so (see NATIVE below) and ships no NOTICE file.
  ['com.google.ai.edge.litert', 'Apache-2.0', null, 'litert@1.4.0 litert-api@1.4.0'],
  ['com.google.android.material', 'Apache-2.0', null, 'material@1.13.0'],
  // The POM declares Apache-2.0 and the JSR-305 sources are BSD-3-Clause (licence-texts/jsr305.txt); both are listed.
  ['com.google.code.findbugs', 'Apache-2.0 AND BSD-3-Clause', 'jsr305.txt', 'jsr305@3.0.2'],
  ['com.google.code.gson', 'Apache-2.0', null, 'gson@2.8.6'],
  ['com.google.errorprone', 'Apache-2.0', null, 'error_prone_annotations@2.15.0'],
  // AutoValue (project and parent POM): Apache-2.0.
  ['com.google.auto.value', 'Apache-2.0', null, 'auto-value-annotations@1.6.3'],
  ['com.google.guava', 'Apache-2.0', null, 'listenablefuture@1.0'],
  // Bolts 1.4.0 is BSD-3-Clause with Facebook's Additional Grant of Patent Rights v2 (both in licence-texts/bolts.txt).
  ['com.parse.bolts', 'BSD-3-Clause with Facebook Additional Grant of Patent Rights v2', 'bolts.txt', 'bolts-tasks@1.4.0'],
  // okhttp ships publicsuffixes.gz, built from the Public Suffix List under MPL-2.0 (its NOTICE says so).
  ['com.squareup.okhttp3', 'Apache-2.0', null, 'okhttp-urlconnection@4.9.2'],
  ['com.squareup.okhttp3', 'Apache-2.0 AND MPL-2.0', null, 'okhttp@4.9.2'],
  ['com.squareup.okio', 'Apache-2.0', null, 'okio@3.16.0 okio-jvm@3.16.0'],
  ['com.squareup.zstd', 'Apache-2.0', null, 'zstd-kmp@0.4.0 zstd-kmp-android@0.4.0 zstd-kmp-okio@0.4.0 zstd-kmp-okio-android@0.4.0'],
  ['com.vanniktech', 'Apache-2.0', null, 'android-image-cropper@4.7.0'],
  ['commons-codec', 'Apache-2.0', null, 'commons-codec@1.10'],
  ['commons-io', 'Apache-2.0', null, 'commons-io@1.4'],
  // The native half of Expo modules installed from npm (their prebuilt AARs); the Expo repository's MIT licence.
  ['expo.modules.asset', 'MIT', 'expo.txt', 'expo.modules.asset@58.0.16'],
  ['expo.modules.router', 'MIT', 'expo.txt', 'expo.modules.router@58.0.22'],
  ['host.exp.exponent', 'MIT', 'expo.txt', 'expo.modules.clipboard@58.0.3 expo.modules.crypto@58.0.7 expo.modules.filesystem@58.0.9 expo.modules.font@58.0.8 expo.modules.haptics@58.0.7 expo.modules.imageloader@58.0.3 expo.modules.imagemanipulator@58.0.14 expo.modules.imagepicker@58.0.10 expo.modules.keepawake@58.0.3 expo.modules.linking@58.0.13 expo.modules.securestore@58.0.2 expo.modules.sharing@58.0.19 expo.modules.splashscreen@58.0.10 expo.modules.sqlite@58.0.13 expo.modules.statusbar@58.0.3 expo.modules.videothumbnails@58.0.2'],
  // zxing-cpp (barcode reader for the scanner, #944): its POM and LICENSE are Apache-2.0; the Android build has writers off, so the bundled libzint is not in it; libzueci is (see NATIVE).
  ['io.github.zxing-cpp', 'Apache-2.0', 'zxing-cpp-android.txt', 'android@3.1.1'],
  ['io.github.expo', 'MIT', 'expo-modules-v2-android.txt', 'expo-modules-v2-react@0.2.5'],
  ['io.github.expo.kolibri', 'MIT', 'expo.txt', 'kolibri-android@0.2.3 runtime@0.2.3'],
  ['io.github.expo.pika', 'MIT', 'expo-pika.txt', 'pika-api@1.1.0'],
  ['io.sentry', 'MIT', 'sentry-java.txt', 'sentry@8.57.0 sentry-android@8.57.0 sentry-android-core@8.57.0 sentry-android-ndk@8.57.0 sentry-android-replay@8.57.0'],
  ['io.sentry', 'MIT', 'sentry-native.txt', 'sentry-native-ndk@0.16.6'],
  ['javax.inject', 'Apache-2.0', null, 'javax.inject@1'],
  ['org.brotli', 'MIT', 'brotli.txt', 'dec@0.1.2'],
  ['org.jetbrains', 'Apache-2.0', null, 'annotations@23.0.0'],
  ['org.jetbrains.kotlin', 'Apache-2.0', null, 'kotlin-android-extensions-runtime@2.0.0 kotlin-annotations-jvm@1.3.72 kotlin-parcelize-runtime@2.0.0 kotlin-reflect@2.2.10 kotlin-stdlib@2.3.20 kotlin-stdlib-jdk7@2.2.10 kotlin-stdlib-jdk8@1.9.24'],
  ['org.jetbrains.kotlinx', 'Apache-2.0', null, 'kotlinx-coroutines-android@1.10.2 kotlinx-coroutines-core@1.10.2 kotlinx-coroutines-core-jvm@1.10.2'],
  ['org.jspecify', 'Apache-2.0', null, 'jspecify@1.0.0'],
];
const androidLicence = new Map(ANDROID_LICENCES.flatMap(([g, licence, file, names]) => names.split(' ').map((n) => [`${g}:${n.replace('@', ':')}`, { licence, file }])));
const checkedAt = (name) => [...androidLicence.keys()].filter((k) => k.startsWith(`${name}:`)).map((k) => k.slice(name.length + 1));
const licenceUrl = (expr) => LICENCE_URL[expr] ?? expr.split(/ AND | OR /).map((id) => LICENCE_URL[id.split(' ')[0]]).filter(Boolean)[0] ?? null;
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// Parses a classpath file into rows; fails, naming each one, on an artifact with no licence row or a NOTICE with no copy.
const parseClasspath = (text, label) => {
  const rows = text.split('\n').filter(Boolean).map((line) => {
    const [coord, ...notices] = line.split(' ');
    const m = coord.match(/^([^:\s]+):([^:\s]+):([^:\s]+)$/);
    if (!m || !notices.every((n) => /^\S+@[0-9a-f]{16}$/.test(n))) { console.error(`${label}: not group:name:version [path@sha256-prefix]...: ${line}`); process.exit(1); }
    return { coord, name: `${m[1]}:${m[2]}`, version: m[3], notices: notices.map((n) => ({ path: n.slice(0, n.lastIndexOf('@')), hash: n.slice(n.lastIndexOf('@') + 1) })) };
  });
  const unknown = rows.filter((r) => !androidLicence.has(r.coord)).map((r) => (checkedAt(r.name).length ? `${r.coord} (row checked at ${checkedAt(r.name).join(', ')})` : r.coord));
  if (unknown.length) {
    console.error(`${label}: no licence in scripts/licences.mjs (ANDROID_LICENCES) for ${unknown.join(', ')}. Each row records the version whose POM and LICENSE were checked: for a new version, check that version's POM, LICENSE and any NOTICE, then update the row's version (and its licence if it changed); for a new artifact, check its POM and project, then add a row.`);
    process.exit(1);
  }
  const noCopy = rows.flatMap((r) => r.notices.filter((n) => !existsSync(join(root, `scripts/licence-texts/notice-${n.hash}.txt`))).map((n) => `${r.coord} ${n.path}`));
  if (noCopy.length) { console.error(`${label}: NOTICE not copied to scripts/licence-texts/notice-<hash>.txt: ${noCopy.join(', ')}`); process.exit(1); }
  for (const r of rows) for (const n of r.notices) {
    if (sha16(readFileSync(join(root, `scripts/licence-texts/notice-${n.hash}.txt`))) !== n.hash) { console.error(`scripts/licence-texts/notice-${n.hash}.txt does not match its hash (${r.coord} ${n.path})`); process.exit(1); }
  }
  return rows;
};
const classpathFile = join(root, 'scripts/android-classpath.txt');
const android = parseClasspath(read(classpathFile), 'scripts/android-classpath.txt').map((r) => {
  const { licence, file } = androidLicence.get(r.coord);
  if (!file && /MIT|BSD/.test(licence)) { console.error(`Android library ${r.coord} is ${licence} and needs its upstream LICENSE in scripts/licence-texts`); process.exit(1); }
  const parts = [file && read(join(root, 'scripts/licence-texts', file)).trim(), licence.includes('Apache-2.0') && SPDX_TEXT['Apache-2.0']].filter(Boolean);
  for (const n of r.notices) {
    parts.push(`NOTICE (${n.path})\n\n${read(join(root, `scripts/licence-texts/notice-${n.hash}.txt`)).trim()}`);
  }
  return { name: r.name, version: r.version, licence, url: licenceUrl(licence), text: textId(parts.join('\n\n----------\n\n')) };
}).sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

// Native code statically linked into the shipped .so files (#904). The Maven rows above list the artifacts; this lists the third-party
// C and C++ inside them. Each entry was checked against the upstream project at the version named (2026-10-18): the version comes from
// React Native's libs.versions.toml and Hermes's external/ directory for the exact release, Fresco's gradle.properties, the zstd-kmp
// submodule and sentry-native's submodules, and the .so files of those releases were checked for the symbols and build paths of each
// library. The notice file is the upstream LICENSE (or, where upstream ships none, the notice in the source file header), in
// scripts/licence-texts/native.
// [id, name, version, licence, url, notice files]
const NATIVE = [
  ['folly', 'Folly', '2024.11.18.00', 'Apache-2.0', 'https://github.com/facebook/folly', ['folly.txt']],
  ['glog', 'glog', '0.3.5', 'BSD-3-Clause', 'https://github.com/google/glog', ['glog.txt']],
  ['double-conversion', 'double-conversion', '1.1.6', 'BSD-3-Clause', 'https://github.com/google/double-conversion', ['double-conversion.txt']],
  ['fast-float', 'fast_float', '8.0.0 (React Native), 8.1.0 (Hermes)', 'MIT', 'https://github.com/fastfloat/fast_float', ['fast-float.txt']], // offered under Apache-2.0, MIT and BSL-1.0; MIT is the one taken
  ['fmt', '{fmt}', '12.1.0', 'MIT', 'https://github.com/fmtlib/fmt', ['fmt.txt']],
  ['boost', 'Boost', '1.83.0 (React Native, headers), 1.86.0 (Hermes, Context)', 'BSL-1.0', 'https://www.boost.org', ['boost.txt']],
  ['libcxx', 'LLVM libc++, libc++abi and libunwind (Android NDK)', '27.1.12297006 (LLVM 18); NDK r25 (LLVM 14.0.6) in libtensorflowlite_jni.so', 'Apache-2.0 WITH LLVM-exception AND (NCSA OR MIT)', 'https://libcxx.llvm.org', ['libcxx.txt']], // LLVM 18 offers the older libc++ code under NCSA or MIT, at the user's choice
  ['llvh', 'LLVM support library (llvh, in Hermes)', 'Hermes 260318099.0.4', 'Apache-2.0 WITH LLVM-exception AND NCSA', 'https://github.com/facebook/hermes/tree/main/external/llvh', ['llvh.txt']],
  ['unicode', 'Unicode character data tables (in Hermes)', 'Unicode 17.0.0, Hermes 260318099.0.4', 'Unicode-3.0', 'https://www.unicode.org/license.txt', ['unicode.txt']],
  ['dtoa', 'dtoa (David M. Gay)', 'netlib, 2016-01-18', 'Lucent permissive notice', 'https://www.netlib.org/fp/', ['dtoa.txt']],
  ['dragonbox', 'Dragonbox', 'beeeef91cf6f', 'Apache-2.0 WITH LLVM-exception OR BSL-1.0', 'https://github.com/jk-jeon/dragonbox', ['dragonbox.txt']],
  ['zip', 'zip and miniz', 'f72dce22bd25', 'Unlicense', 'https://github.com/kuba--/zip', ['zip-miniz.txt']],
  ['libjpeg-turbo', 'libjpeg-turbo', '2.1.5.1', 'IJG AND BSD-3-Clause AND Zlib', 'https://libjpeg-turbo.org', ['libjpeg-turbo.txt']],
  ['libwebp', 'libwebp', '1.3.2', 'BSD-3-Clause', 'https://chromium.googlesource.com/webm/libwebp', ['libwebp.txt']],
  ['giflib', 'giflib', '5.2.1', 'MIT', 'https://giflib.sourceforge.net', ['giflib.txt', 'openbsd-reallocarray.txt']],
  ['zstd', 'Zstandard', '1.5.8 (development snapshot 1dbc2e0)', 'BSD-3-Clause', 'https://github.com/facebook/zstd', ['zstd.txt']], // dual-licensed BSD-3-Clause or GPL-2.0; the BSD licence is the one taken
  ['zxing-cpp', 'zxing-cpp', '3.1.1', 'Apache-2.0', 'https://github.com/zxing-cpp/zxing-cpp', ['zxing-cpp.txt']], // statically links LLVM libc++ of NDK 27.1.12297006 (libcxx); the Android build has writers off, so the repo's libzint is not compiled in, but its reader build compiles libzueci (core/CMakeLists.txt, ZXING_READERS)
  ['libzueci', 'libzueci (in zxing-cpp)', 'bundled in zxing-cpp 3.1.1', 'BSD-3-Clause AND MIT', 'https://github.com/zxing-cpp/zxing-cpp/tree/v3.1.1/core/src/libzueci', ['libzueci.txt']], // BSD-3-Clause, plus Bjoern Hoehrmann's UTF-8 decoder (MIT-style notice) inside zueci.c
  ['libyuv', 'libyuv (in AndroidX CameraX camera-core)', 'bundled in androidx.camera:camera-core 1.5.2', 'BSD-3-Clause', 'https://chromium.googlesource.com/libyuv/libyuv', ['libyuv.txt']],
  // TensorFlow Lite in LiteRT 1.4.0 (live pose tracking, #947). Checked 2026-10-19 against the AAR's libtensorflowlite_jni.so (arm64-v8a,
  // stripped, built with NDK r25 clang 14.0.6): build paths of external/ruy and external/KleidiAI, XNNPACK delegate and messages,
  // cpuinfo, gemmlowp and fft2d messages, EigenForTFLite and flatbuffers symbols, and a statically linked libc++ (no libc++_shared needed).
  // pthreadpool, FP16 and FXdiv are XNNPACK's own dependencies, NEON_2_SSE is TensorFlow Lite's x86 NEON shim, and farmhash and Abseil are
  // deps of TensorFlow Lite's builtin kernels (tensorflow/lite/kernels/BUILD at v2.19.0: lsh_projection.cc is in the builtin kernel sources and
  // its library depends on @farmhash_archive//:farmhash; absl strings, types:span, algorithm and base are deps of the core and kernel
  // libraries): listed from their build files, not visible by name in the stripped binary. The version is whatever LiteRT 1.4.0 pins; the notice is the upstream
  // licence file as of that check.
  ['xnnpack', 'XNNPACK (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'BSD-3-Clause', 'https://github.com/google/XNNPACK', ['xnnpack.txt']],
  ['kleidiai', 'KleidiAI (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'Apache-2.0 AND BSD-3-Clause', 'https://github.com/ARM-software/kleidiai', ['kleidiai-apache.txt', 'kleidiai-bsd.txt']], // the matmul kernels in the library carry Apache-2.0 headers; the repository also holds BSD-3-Clause files
  ['ruy', 'ruy (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'Apache-2.0', 'https://github.com/google/ruy', ['apache-2.0.txt']],
  ['gemmlowp', 'gemmlowp (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'Apache-2.0', 'https://github.com/google/gemmlowp', ['apache-2.0.txt']],
  ['flatbuffers', 'FlatBuffers (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'Apache-2.0', 'https://github.com/google/flatbuffers', ['apache-2.0.txt']],
  ['farmhash', 'FarmHash (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'MIT', 'https://github.com/google/farmhash', ['farmhash.txt']],
  ['abseil', 'Abseil C++ (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'Apache-2.0', 'https://github.com/abseil/abseil-cpp', ['apache-2.0.txt']],
  ['cpuinfo', 'cpuinfo (in XNNPACK)', 'bundled in litert 1.4.0', 'BSD-2-Clause', 'https://github.com/pytorch/cpuinfo', ['cpuinfo.txt']],
  ['pthreadpool', 'pthreadpool (in XNNPACK)', 'bundled in litert 1.4.0', 'BSD-2-Clause', 'https://github.com/google/pthreadpool', ['pthreadpool.txt']],
  ['fp16', 'FP16 (in XNNPACK)', 'bundled in litert 1.4.0', 'MIT', 'https://github.com/Maratyszcza/FP16', ['fp16.txt']],
  ['fxdiv', 'FXdiv (in XNNPACK)', 'bundled in litert 1.4.0', 'MIT', 'https://github.com/Maratyszcza/FXdiv', ['fxdiv.txt']],
  ['eigen-threadpool', 'Eigen thread pool (EigenForTFLite, in TensorFlow Lite)', 'bundled in litert 1.4.0', 'MPL-2.0', 'https://gitlab.com/libeigen/eigen', ['eigen-mpl2.txt']],
  ['fft2d', 'FFT package by Takuya Ooura (in TensorFlow Lite)', 'bundled in litert 1.4.0', 'Ooura permissive notice', 'https://github.com/tensorflow/tensorflow/tree/master/third_party/fft2d', ['fft2d.txt']],
  ['neon-2-sse', 'ARM NEON to x86 SSE shim (in TensorFlow Lite, x86 builds)', 'bundled in litert 1.4.0', 'BSD-3-Clause-like (Intel licence agreement)', 'https://github.com/intel/ARM_NEON_2_x86_SSE', ['neon-2-sse.txt']],
  ['sqlite', 'SQLite', '3.53.3', 'Public domain', 'https://sqlite.org', ['sqlite.txt']],
  ['libunwindstack', 'libunwindstack-ndk (Android Open Source Project)', '284202fb1e42', 'Apache-2.0', 'https://github.com/getsentry/libunwindstack-ndk', ['libunwindstack.txt']],
  ['mpack', 'MPack', '1.0', 'MIT', 'https://github.com/ludocode/mpack', ['mpack.txt']],
  ['jsmn', 'jsmn', 'vendored in sentry-native 0.16.6', 'MIT', 'https://github.com/zserge/jsmn', ['jsmn.txt']],
  ['worklets-queue', 'ThreadSafeQueue (Juan Palacios)', 'in react-native-worklets 0.13.0', 'BSD-2-Clause', 'https://opensource.org/license/bsd-2-clause', ['worklets-queue.txt']],
];
// Every .so name the release build can ship, with the NATIVE ids linked into it ([] = only code listed elsewhere on this screen:
// React Native, Hermes, Fresco, Sentry, Expo and the app's own native modules). A .so with no entry here fails the script, so a new
// native library is looked at on purpose.
const NATIVE_SO = {
  'libc++_shared.so': ['libcxx'],
  'libfbjni.so': [],
  'libhermestooling.so': [],
  'libhermesvm.so': ['llvh', 'unicode', 'boost', 'dtoa', 'dragonbox', 'fast-float', 'zip'],
  'libjsi.so': ['folly', 'glog', 'double-conversion', 'fast-float'],
  'libreactnative.so': ['folly', 'glog', 'double-conversion', 'fast-float', 'fmt', 'boost'],
  'libgifimage.so': ['giflib'],
  'libimagepipeline.so': [],
  'libnative-filters.so': [],
  'libnative-imagetranscoder.so': ['libjpeg-turbo'],
  'libstatic-webp.so': ['libwebp'],
  'libsentry-android.so': [],
  'libsentry.so': ['libunwindstack', 'mpack', 'jsmn', 'libcxx'],
  'libsentry-tm-perf-logger.so': [],
  'libzstd-kmp.so': ['zstd'],
  'libexpo-modules-core.so': [],
  'libexpo-modules-jsi.so': [],
  'libexpo-modules-v2.so': [],
  'libexpo-modules-worklets.so': [],
  'libexpo-sqlite.so': ['sqlite'],
  'libzxingcpp_android.so': ['zxing-cpp', 'libzueci', 'libcxx'],
  'libimage_processing_util_jni.so': ['libyuv'],
  'libsurface_util_jni.so': [],
  'libtensorflowlite_jni.so': ['xnnpack', 'kleidiai', 'ruy', 'gemmlowp', 'flatbuffers', 'cpuinfo', 'pthreadpool', 'fp16', 'fxdiv', 'eigen-threadpool', 'fft2d', 'neon-2-sse', 'farmhash', 'abseil', 'libcxx'],
  'libworklets.so': ['worklets-queue'],
  'libreanimated.so': [],
  'libgesturehandler.so': [],
  'librnscreens.so': [],
  'libreact_codegen_rngesturehandler_codegen.so': [],
  'libreact_codegen_rnscreens.so': [],
  'libreact_codegen_rnsvg.so': [],
  'libreact_codegen_safeareacontext.so': [],
  'libappmodules.so': [],
};
const parseSoList = (text, label) => {
  const names = text.split('\n').filter(Boolean);
  const unknown = names.filter((n) => !(n in NATIVE_SO));
  if (unknown.length) {
    console.error(`${label}: no notice for native library ${unknown.join(', ')}. Find which third-party code is statically linked into it (build paths and symbols in the .so, the upstream project's third-party list), add its entry to NATIVE with the upstream notice in scripts/licence-texts/native, then map the .so in NATIVE_SO (scripts/licences.mjs).`);
    process.exit(1);
  }
  return names;
};
const nativeSoFile = join(root, 'scripts/android-native-libs.txt');
const soNames = parseSoList(read(nativeSoFile), 'scripts/android-native-libs.txt');
const native = NATIVE.map(([id, name, version, licence, url, files]) => {
  const usedIn = soNames.filter((n) => NATIVE_SO[n].includes(id));
  return { id, name, version, licence, url, files, usedIn };
}).filter((c) => c.usedIn.length).map((c) => ({
  name: c.name, version: c.version, licence: c.licence, url: c.url, in: c.usedIn,
  text: textId(c.files.map((f) => read(join(root, 'scripts/licence-texts/native', f)).trim()).join('\n\n----------\n\n')),
})).sort((a, b) => a.name.localeCompare(b.name));
const unusedNative = NATIVE.filter(([id]) => !Object.values(NATIVE_SO).some((ids) => ids.includes(id))).map(([id]) => id);
if (unusedNative.length) { console.error(`NATIVE entries no .so maps to: ${unusedNative.join(', ')}`); process.exit(1); }

// Bundled fonts and icons
const MIT_IONIC = 'MIT License\n\nCopyright (c) 2015-present Ionic (http://ionic.io/)\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
const assets = [
  { name: 'Inter (font)', version: null, licence: 'OFL-1.1', url: 'https://github.com/rsms/inter', text: textId(read(join(root, 'public/licenses/Inter-OFL-1.1.txt'))) },
  { name: 'Roboto (font)', version: null, licence: 'OFL-1.1', url: 'https://github.com/googlefonts/roboto-classic', text: textId(read(join(root, 'public/licenses/Roboto-OFL-1.1.txt'))) },
  { name: 'Ionicons (icons)', version: null, licence: 'MIT', url: 'https://github.com/ionic-team/ionicons', text: textId(MIT_IONIC) },
  // Live pose tracking on the web (#947): the model weights and the WebAssembly runtime are files we serve from public/pose.
  { name: 'MoveNet Lightning (pose model weights)', version: '4', licence: 'Apache-2.0', url: 'https://www.kaggle.com/models/google/movenet/TfJs/singlepose-lightning', text: textId(read(join(root, 'public/pose/movenet-lightning/LICENSE.txt'))) },
  // Live pose tracking on Android (#947): the model weights are bundled in the app as an asset of the plate-pose module.
  { name: 'MoveNet Lightning (pose model weights, Android, TensorFlow Lite float16)', version: '1', licence: 'Apache-2.0', url: 'https://www.kaggle.com/models/google/movenet/tfLite/singlepose-lightning-tflite-float16', text: textId(read(join(root, 'modules/plate-pose/MODEL-LICENSE.txt'))) },
  // Web barcode scanner (#944): the reader we serve from public/zxing, built from the ZXing-C++ commit zxing-wasm 3.1.3 pins (a17fd9dc).
  { name: 'ZXing-C++ WebAssembly reader (web barcode scanner)', version: '3.1.3 (zxing-wasm)', licence: 'Apache-2.0 AND BSD-3-Clause AND MIT', url: 'https://github.com/Sec-ant/zxing-wasm', text: textId(read(join(root, 'public/zxing/LICENSE.txt'))) },
  { name: 'TensorFlow.js WebAssembly runtime (pose tracking)', version: '4.22.0', licence: 'Apache-2.0 (contains XNNPACK, BSD-3-Clause, and Emscripten, MIT)', url: 'https://github.com/tensorflow/tfjs', text: textId(read(join(root, 'public/pose/wasm/LICENSE.txt'))) },
];

// Release builds: the classpath Gradle resolved must have a licence for every artifact and match the committed list.
const classpathArg = process.argv.indexOf('--classpath');
if (classpathArg !== -1) {
  const file = process.argv[classpathArg + 1];
  if (!file || !existsSync(file)) { console.error('--classpath needs the file written by scripts/android-classpath.init.gradle'); process.exit(1); }
  const got = parseClasspath(read(file), file).map((r) => [r.coord, ...r.notices.map((n) => `${n.path}@${n.hash}`)].join(' '));
  const want = read(classpathFile).split('\n').filter(Boolean);
  const added = got.filter((l) => !want.includes(l));
  const removed = want.filter((l) => !got.includes(l));
  if (added.length || removed.length) {
    console.error(`the release build's Android classpath differs from scripts/android-classpath.txt (every version in it has a checked licence row; check any new NOTICE first): copy ${file} over it, then run \`node scripts/licences.mjs\`.`);
    for (const l of added) console.error(`  + ${l}`);
    for (const l of removed) console.error(`  - ${l}`);
    process.exit(1);
  }
  console.log(`the release build's Android classpath matches scripts/android-classpath.txt (${got.length} libraries)`);
  process.exit(0);
}

// Release builds: the .so files of the built APK must be the ones in the committed list (and so each has a notice).
const nativeArg = process.argv.indexOf('--native-libs');
if (nativeArg !== -1) {
  const file = process.argv[nativeArg + 1];
  if (!file || !existsSync(file)) { console.error('--native-libs needs a file with the .so file names of the release APK, one per line'); process.exit(1); }
  const got = parseSoList(read(file), file);
  const added = got.filter((n) => !soNames.includes(n));
  const removed = soNames.filter((n) => !got.includes(n));
  if (added.length || removed.length) {
    console.error(`the release build's .so files differ from scripts/android-native-libs.txt: check any new library's third-party code (NATIVE in scripts/licences.mjs), then copy ${file} over it and run \`node scripts/licences.mjs\`.`);
    for (const n of added) console.error(`  + ${n}`);
    for (const n of removed) console.error(`  - ${n}`);
    process.exit(1);
  }
  console.log(`the release build's .so files match scripts/android-native-libs.txt (${got.length} libraries)`);
  process.exit(0);
}

// NOTICE and THIRD_PARTY.md must agree on the app images in assets/ (#965). They are our own artwork (rendered from assets/brand/*.svg by
// tools/brand-icons/render.mjs), so THIRD_PARTY.md lists them as own work and NOTICE, which lists third-party material only, must not credit them.
// LICENCES_REPO_DIR points the check at another NOTICE and THIRD_PARTY.md (the tests use it); it defaults to the repository root.
const repo = process.env.LICENCES_REPO_DIR ?? join(root, '../..');
if (existsSync(join(repo, 'NOTICE')) && existsSync(join(repo, 'THIRD_PARTY.md'))) {
  const ownRow = read(join(repo, 'THIRD_PARTY.md')).split('\n').find((l) => l.includes('apps/mobile/assets') && /own work/i.test(l));
  if (!ownRow) { console.error('THIRD_PARTY.md has no row marking the app icon and splash images in apps/mobile/assets as own work; add it (the images are rendered from assets/brand/*.svg) or update this check.'); process.exit(1); }
  const notice = read(join(repo, 'NOTICE'));
  const pngs = [...read(join(root, 'app.json')).matchAll(/\.\/assets\/([\w.-]+\.png)/g)].map((m) => m[1]);
  const listed = [...pngs.filter((f) => new RegExp(`(^|[\\s/])${f.replace(/\./g, '\\.')}`).test(notice)), ...(notice.match(/\b(app icon|splash)\b/i) ?? []).slice(0, 1)];
  if (listed.length) { console.error(`NOTICE lists ${listed[0]} but THIRD_PARTY.md marks it own work: make the two agree.`); process.exit(1); }
}

const sortedTexts = Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)));
const out = `${JSON.stringify({ packages, android, native, assets, texts: sortedTexts })}\n`;
if (check) {
  if (!existsSync(outFile) || read(outFile) !== out) { console.error('src/about/licences.json is stale: run `node scripts/licences.mjs` in apps/mobile after npm ci'); process.exit(1); }
  console.log(`licences.json is current (${packages.length} npm, ${android.length} Android, ${native.length} native, ${assets.length} assets)`);
} else {
  writeFileSync(outFile, out);
  console.log(`wrote ${outFile}: ${packages.length} npm, ${android.length} Android, ${native.length} native, ${assets.length} assets, ${Object.keys(texts).length} texts`);
}
