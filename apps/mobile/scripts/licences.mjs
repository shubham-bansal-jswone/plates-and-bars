// Builds src/about/licences.json: the open-source licences shown on the About screen.
//
//   node scripts/licences.mjs                    regenerate (needs `npm ci` first)
//   node scripts/licences.mjs --check            exit 1 if the committed file is stale (CI; also run by __tests__/licences-script.test.ts)
//   node scripts/licences.mjs --classpath <file> exit 1 if <file>, the classpath a release build resolved, names an artifact with
//                                                no licence row or differs from scripts/android-classpath.txt (android-release.yml)
//
// Sources, with no new dependency:
//   - npm: every package in package-lock.json that is not dev-only, read from node_modules (name, version, licence, notice text).
//     Optional-only entries and entries restricted to an os or cpu (platform binaries such as lightningcss-darwin-arm64, fsevents, wasm fallbacks) are left out so the file
//     is the same on every machine; they are build tools, not part of the app.
//   - Android: the Maven libraries of the release build, as Gradle resolved them (scripts/android-classpath.txt, committed so this
//     runs without an Android build), each with a licence from the ANDROID_LICENCES table and any NOTICE file it ships.
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
// how to regenerate it). Every artifact needs a row in ANDROID_LICENCES below, checked against its POM and project (2026-10-18):
// an artifact without one fails the script with its name, so the table is completed on purpose and never guessed.
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
// [group, licence (SPDX), upstream licence text in scripts/licence-texts or null, artifact names in that group]
const ANDROID_LICENCES = [
  ['androidx.activity', 'Apache-2.0', null, 'activity activity-ktx'],
  ['androidx.annotation', 'Apache-2.0', null, 'annotation annotation-experimental annotation-jvm'],
  ['androidx.appcompat', 'Apache-2.0', null, 'appcompat appcompat-resources'],
  ['androidx.arch.core', 'Apache-2.0', null, 'core-common core-runtime'],
  ['androidx.autofill', 'Apache-2.0', null, 'autofill'],
  ['androidx.biometric', 'Apache-2.0', null, 'biometric'],
  ['androidx.cardview', 'Apache-2.0', null, 'cardview'],
  ['androidx.collection', 'Apache-2.0', null, 'collection collection-jvm collection-ktx'],
  ['androidx.concurrent', 'Apache-2.0', null, 'concurrent-futures'],
  ['androidx.constraintlayout', 'Apache-2.0', null, 'constraintlayout constraintlayout-core'],
  ['androidx.coordinatorlayout', 'Apache-2.0', null, 'coordinatorlayout'],
  ['androidx.core', 'Apache-2.0', null, 'core core-ktx core-splashscreen core-viewtree'],
  ['androidx.cursoradapter', 'Apache-2.0', null, 'cursoradapter'],
  ['androidx.customview', 'Apache-2.0', null, 'customview'],
  ['androidx.databinding', 'Apache-2.0', null, 'viewbinding'],
  ['androidx.documentfile', 'Apache-2.0', null, 'documentfile'],
  ['androidx.drawerlayout', 'Apache-2.0', null, 'drawerlayout'],
  ['androidx.dynamicanimation', 'Apache-2.0', null, 'dynamicanimation'],
  ['androidx.emoji2', 'Apache-2.0', null, 'emoji2 emoji2-views-helper'],
  ['androidx.exifinterface', 'Apache-2.0', null, 'exifinterface'],
  ['androidx.fragment', 'Apache-2.0', null, 'fragment fragment-ktx'],
  ['androidx.graphics', 'Apache-2.0', null, 'graphics-shapes graphics-shapes-android'],
  ['androidx.interpolator', 'Apache-2.0', null, 'interpolator'],
  ['androidx.lifecycle', 'Apache-2.0', null, 'lifecycle-common lifecycle-common-java8 lifecycle-livedata lifecycle-livedata-core lifecycle-livedata-core-ktx lifecycle-process lifecycle-runtime lifecycle-runtime-ktx lifecycle-viewmodel lifecycle-viewmodel-ktx lifecycle-viewmodel-savedstate'],
  ['androidx.loader', 'Apache-2.0', null, 'loader'],
  ['androidx.profileinstaller', 'Apache-2.0', null, 'profileinstaller'],
  ['androidx.recyclerview', 'Apache-2.0', null, 'recyclerview'],
  ['androidx.resourceinspection', 'Apache-2.0', null, 'resourceinspection-annotation'],
  ['androidx.savedstate', 'Apache-2.0', null, 'savedstate savedstate-ktx'],
  ['androidx.startup', 'Apache-2.0', null, 'startup-runtime'],
  ['androidx.swiperefreshlayout', 'Apache-2.0', null, 'swiperefreshlayout'],
  ['androidx.tracing', 'Apache-2.0', null, 'tracing tracing-ktx'],
  ['androidx.transition', 'Apache-2.0', null, 'transition transition-ktx'],
  ['androidx.vectordrawable', 'Apache-2.0', null, 'vectordrawable vectordrawable-animated'],
  ['androidx.versionedparcelable', 'Apache-2.0', null, 'versionedparcelable'],
  ['androidx.viewpager', 'Apache-2.0', null, 'viewpager'],
  ['androidx.viewpager2', 'Apache-2.0', null, 'viewpager2'],
  ['androidx.window', 'Apache-2.0', null, 'window window-core window-core-android'],
  ['com.abovevacant', 'MIT', 'epitaph.txt', 'epitaph'],
  ['com.facebook.fbjni', 'Apache-2.0', null, 'fbjni'],
  ['com.facebook.fresco', 'MIT', 'fresco.txt', 'animated-base animated-drawable animated-gif animated-gif-lite drawee fbcore fresco imagepipeline imagepipeline-base imagepipeline-native imagepipeline-okhttp3 memory-type-ashmem memory-type-java memory-type-native middleware nativeimagefilters nativeimagetranscoder soloader ui-common ui-core urimod vito-core vito-core-common-impl vito-core-impl vito-core-java-impl vito-drawee-support vito-options vito-provider vito-renderer vito-source webpsupport'],
  ['com.facebook.hermes', 'MIT', 'hermes.txt', 'hermes-android'],
  ['com.facebook.infer.annotation', 'MIT', 'infer-annotation.txt', 'infer-annotation'],
  ['com.facebook.react', 'MIT', 'react-native.txt', 'react-android'],
  ['com.facebook.soloader', 'Apache-2.0', null, 'annotation nativeloader soloader'],
  ['com.facebook.yoga', 'MIT', 'yoga.txt', 'proguard-annotations'],
  // The POM names BSD and Apache-2.0; Glide's LICENSE is BSD-2-Clause with MIT and Apache parts for bundled third-party code.
  ['com.github.bumptech.glide', 'BSD-2-Clause AND MIT AND Apache-2.0', 'glide.txt', 'annotations disklrucache gifdecoder glide'],
  ['com.google.android.material', 'Apache-2.0', null, 'material'],
  // The POM declares Apache-2.0 and the JSR-305 sources are BSD-3-Clause (licence-texts/jsr305.txt); both are listed.
  ['com.google.code.findbugs', 'Apache-2.0 AND BSD-3-Clause', 'jsr305.txt', 'jsr305'],
  ['com.google.code.gson', 'Apache-2.0', null, 'gson'],
  ['com.google.errorprone', 'Apache-2.0', null, 'error_prone_annotations'],
  ['com.google.guava', 'Apache-2.0', null, 'listenablefuture'],
  // Bolts 1.4.0 is BSD-3-Clause with Facebook's Additional Grant of Patent Rights v2 (both in licence-texts/bolts.txt).
  ['com.parse.bolts', 'BSD-3-Clause', 'bolts.txt', 'bolts-tasks'],
  // okhttp ships publicsuffixes.gz, built from the Public Suffix List under MPL-2.0 (its NOTICE says so).
  ['com.squareup.okhttp3', 'Apache-2.0', null, 'okhttp-urlconnection'],
  ['com.squareup.okhttp3', 'Apache-2.0 AND MPL-2.0', null, 'okhttp'],
  ['com.squareup.okio', 'Apache-2.0', null, 'okio okio-jvm'],
  ['com.squareup.zstd', 'Apache-2.0', null, 'zstd-kmp zstd-kmp-android zstd-kmp-okio zstd-kmp-okio-android'],
  ['com.vanniktech', 'Apache-2.0', null, 'android-image-cropper'],
  ['commons-codec', 'Apache-2.0', null, 'commons-codec'],
  ['commons-io', 'Apache-2.0', null, 'commons-io'],
  // The native half of Expo modules installed from npm (their prebuilt AARs); the Expo repository's MIT licence.
  ['expo.modules.asset', 'MIT', 'expo.txt', 'expo.modules.asset'],
  ['expo.modules.router', 'MIT', 'expo.txt', 'expo.modules.router'],
  ['host.exp.exponent', 'MIT', 'expo.txt', 'expo.modules.clipboard expo.modules.crypto expo.modules.filesystem expo.modules.font expo.modules.imageloader expo.modules.imagemanipulator expo.modules.imagepicker expo.modules.keepawake expo.modules.linking expo.modules.securestore expo.modules.sharing expo.modules.splashscreen expo.modules.sqlite expo.modules.statusbar'],
  ['io.github.expo', 'MIT', 'expo-modules-v2-android.txt', 'expo-modules-v2-react'],
  ['io.github.expo.kolibri', 'MIT', 'expo.txt', 'kolibri-android runtime'],
  ['io.github.expo.pika', 'MIT', 'expo-pika.txt', 'pika-api'],
  ['io.sentry', 'MIT', 'sentry-java.txt', 'sentry sentry-android sentry-android-core sentry-android-ndk sentry-android-replay'],
  ['io.sentry', 'MIT', 'sentry-native.txt', 'sentry-native-ndk'],
  ['javax.inject', 'Apache-2.0', null, 'javax.inject'],
  ['org.brotli', 'MIT', 'brotli.txt', 'dec'],
  ['org.jetbrains', 'Apache-2.0', null, 'annotations'],
  ['org.jetbrains.kotlin', 'Apache-2.0', null, 'kotlin-android-extensions-runtime kotlin-annotations-jvm kotlin-parcelize-runtime kotlin-reflect kotlin-stdlib kotlin-stdlib-jdk7 kotlin-stdlib-jdk8'],
  ['org.jetbrains.kotlinx', 'Apache-2.0', null, 'kotlinx-coroutines-android kotlinx-coroutines-core kotlinx-coroutines-core-jvm'],
  ['org.jspecify', 'Apache-2.0', null, 'jspecify'],
];
const androidLicence = new Map(ANDROID_LICENCES.flatMap(([g, licence, file, names]) => names.split(' ').map((n) => [`${g}:${n}`, { licence, file }])));
const licenceUrl = (expr) => LICENCE_URL[expr] ?? expr.split(/ AND | OR /).map((id) => LICENCE_URL[id]).filter(Boolean)[0] ?? null;
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// Parses a classpath file into rows; fails, naming each one, on an artifact with no licence row or a NOTICE with no copy.
const parseClasspath = (text, label) => {
  const rows = text.split('\n').filter(Boolean).map((line) => {
    const [coord, ...notices] = line.split(' ');
    const m = coord.match(/^([^:\s]+):([^:\s]+):([^:\s]+)$/);
    if (!m || !notices.every((n) => /^\S+@[0-9a-f]{16}$/.test(n))) { console.error(`${label}: not group:name:version [path@sha256-prefix]...: ${line}`); process.exit(1); }
    return { coord, name: `${m[1]}:${m[2]}`, version: m[3], notices: notices.map((n) => ({ path: n.slice(0, n.lastIndexOf('@')), hash: n.slice(n.lastIndexOf('@') + 1) })) };
  });
  const unknown = rows.filter((r) => !androidLicence.has(r.name)).map((r) => r.coord);
  if (unknown.length) { console.error(`${label}: no licence in scripts/licences.mjs (ANDROID_LICENCES) for ${unknown.join(', ')}. Check each one's POM and project, then add it.`); process.exit(1); }
  const noCopy = rows.flatMap((r) => r.notices.filter((n) => !existsSync(join(root, `scripts/licence-texts/notice-${n.hash}.txt`))).map((n) => `${r.coord} ${n.path}`));
  if (noCopy.length) { console.error(`${label}: NOTICE not copied to scripts/licence-texts/notice-<hash>.txt: ${noCopy.join(', ')}`); process.exit(1); }
  return rows;
};
const classpathFile = join(root, 'scripts/android-classpath.txt');
const android = parseClasspath(read(classpathFile), 'scripts/android-classpath.txt').map((r) => {
  const { licence, file } = androidLicence.get(r.name);
  if (!file && /MIT|BSD/.test(licence)) { console.error(`Android library ${r.coord} is ${licence} and needs its upstream LICENSE in scripts/licence-texts`); process.exit(1); }
  const parts = [file && read(join(root, 'scripts/licence-texts', file)).trim(), licence.includes('Apache-2.0') && SPDX_TEXT['Apache-2.0']].filter(Boolean);
  for (const n of r.notices) {
    const copy = readFileSync(join(root, `scripts/licence-texts/notice-${n.hash}.txt`));
    if (sha16(copy) !== n.hash) { console.error(`scripts/licence-texts/notice-${n.hash}.txt does not match its hash (${r.coord} ${n.path})`); process.exit(1); }
    parts.push(`NOTICE (${n.path})\n\n${copy.toString('utf8').trim()}`);
  }
  return { name: r.name, version: r.version, licence, url: licenceUrl(licence), text: textId(parts.join('\n\n----------\n\n')) };
}).sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

// Bundled fonts and icons
const MIT_IONIC = 'MIT License\n\nCopyright (c) 2015-present Ionic (http://ionic.io/)\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
const assets = [
  { name: 'Inter (font)', version: null, licence: 'OFL-1.1', url: 'https://github.com/rsms/inter', text: textId(read(join(root, 'public/licenses/Inter-OFL-1.1.txt'))) },
  { name: 'Roboto (font)', version: null, licence: 'OFL-1.1', url: 'https://github.com/googlefonts/roboto-classic', text: textId(read(join(root, 'public/licenses/Roboto-OFL-1.1.txt'))) },
  { name: 'Ionicons (icons)', version: null, licence: 'MIT', url: 'https://github.com/ionic-team/ionicons', text: textId(MIT_IONIC) },
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
    console.error(`the release build's Android classpath differs from scripts/android-classpath.txt: copy ${file} over it, then run \`node scripts/licences.mjs\`.`);
    for (const l of added) console.error(`  + ${l}`);
    for (const l of removed) console.error(`  - ${l}`);
    process.exit(1);
  }
  console.log(`the release build's Android classpath matches scripts/android-classpath.txt (${got.length} libraries)`);
  process.exit(0);
}

const sortedTexts = Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)));
const out = `${JSON.stringify({ packages, android, assets, texts: sortedTexts })}\n`;
if (check) {
  if (!existsSync(outFile) || read(outFile) !== out) { console.error('src/about/licences.json is stale: run `node scripts/licences.mjs` in apps/mobile after npm ci'); process.exit(1); }
  console.log(`licences.json is current (${packages.length} npm, ${android.length} Android, ${assets.length} assets)`);
} else {
  writeFileSync(outFile, out);
  console.log(`wrote ${outFile}: ${packages.length} npm, ${android.length} Android, ${assets.length} assets, ${Object.keys(texts).length} texts`);
}
