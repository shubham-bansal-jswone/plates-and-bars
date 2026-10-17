// Builds src/about/licences.json: the open-source licences shown on the About screen.
//
//   node scripts/licences.mjs           regenerate (needs `npm ci` first)
//   node scripts/licences.mjs --check   exit 1 if the committed file is stale (CI; also run by __tests__/licences-script.test.ts)
//
// Sources, with no new dependency:
//   - npm: every package in package-lock.json that is not dev-only, read from node_modules (name, version, licence, notice text).
//     Optional-only entries and entries restricted to an os or cpu (platform binaries such as lightningcss-darwin-arm64, fsevents, wasm fallbacks) are left out so the file
//     is the same on every machine; they are build tools, not part of the app.
//   - Android: Maven libraries declared in the Gradle files of those packages (android/build.gradle) and in React Native's
//     libs.versions.toml. This is a static scan, not a resolved Gradle build, so transitive libraries are not included.
//     Every declared library must resolve to a version (literal, a def/ext in the same file, the React Native catalogue, or
//     the tables below) and to a licence; anything else fails the script instead of being skipped.
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
// Licence texts attached to every Android row (the licences require the text, with its copyright notice, to accompany the work).
// Apache-2.0 names no holder, so one standard text taken from an installed npm package serves for all. MIT and BSD texts carry a
// copyright line, so each such artifact needs its own upstream LICENSE copied into scripts/licence-texts/ (checked against the
// upstream repository on 2026-10-17); an MIT or BSD artifact without one fails the script.
const apacheText = [...npm.values()].map((e) => ({ e, t: noticeFile(dirOf.get(`${e.name}@${e.version}`)) })).find(({ e, t }) => e.licence === 'Apache-2.0' && t?.includes('Version 2.0, January 2004'))?.t;
if (!apacheText) { console.error('no Apache-2.0 licence text found among the npm packages'); process.exit(1); }
const SPDX_TEXT = { 'Apache-2.0': apacheText.split('\n\nNOTICE\n\n')[0] };
const LICENCE_URL = {
  'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
  MIT: 'https://opensource.org/license/mit',
  'BSD-2-Clause': 'https://opensource.org/license/bsd-2-clause',
  'BSD-3-Clause': 'https://opensource.org/license/bsd-3-clause',
  'CDDL-1.1': 'https://github.com/javaee/javax.annotation/blob/master/LICENSE',
};
// First matching prefix wins, so specific entries come before general ones. Each library is mapped by artifact, not by
// vendor: com.facebook.soloader and fbjni are Apache-2.0 while Fresco, Yoga and Infer annotations are MIT.
const NATIVE_LICENCE = [
  ['com.facebook.soloader:', 'Apache-2.0'],
  ['com.facebook.fbjni:', 'Apache-2.0'],
  ['com.facebook.fresco:', 'MIT'],
  ['com.facebook.yoga:', 'MIT'],
  ['com.facebook.infer.annotation:', 'MIT'],
  ['androidx.', 'Apache-2.0'],
  ['com.google.android.material:', 'Apache-2.0'],
  ['org.jetbrains.kotlin:', 'Apache-2.0'],
  ['org.jetbrains.kotlinx:', 'Apache-2.0'],
  ['com.squareup.', 'Apache-2.0'],
  ['com.google.code.gson:', 'Apache-2.0'],
  ['commons-io:', 'Apache-2.0'],
  ['commons-codec:', 'Apache-2.0'],
  ['javax.inject:', 'Apache-2.0'],
  ['javax.annotation:', 'CDDL-1.1 OR GPL-2.0-only WITH Classpath-exception-2.0'],
  // jsr305 3.0.2: the Maven POM declares Apache-2.0 and the JSR-305 sources are BSD-3-Clause; both are listed.
  ['com.google.code.findbugs:jsr305', 'Apache-2.0 AND BSD-3-Clause'],
  ['com.github.bumptech.glide:', 'BSD-2-Clause AND MIT AND Apache-2.0'],
  ['io.github.expo', 'MIT'],
  ['io.sentry:', 'MIT'],
  ['org.brotli:', 'MIT'],
  ['com.vanniktech:', 'Apache-2.0'],
];
const nativeLicence = (coord) => NATIVE_LICENCE.find(([k]) => coord.startsWith(k))?.[1];
const UPSTREAM_TEXT = [
  ['com.facebook.fresco:', 'fresco.txt'],
  ['com.facebook.yoga:', 'yoga.txt'],
  ['com.facebook.infer.annotation:', 'infer-annotation.txt'],
  ['com.github.bumptech.glide:', 'glide.txt'], // BSD-2-Clause, with the MIT and Apache parts for its bundled third-party code
  ['org.brotli:', 'brotli.txt'],
  ['io.sentry:', 'sentry-java.txt'],
  ['io.github.expo.pika:', 'expo-pika.txt'],
  ['io.github.expo.kolibri:', 'expo-kolibri.txt'],
  ['io.github.expo:', 'expo-modules-v2-android.txt'],
  ['com.google.code.findbugs:jsr305', 'jsr305.txt'], // the BSD-3-Clause part; the Apache part is the standard text
];
const licenceText = (coord, expr) => {
  const ids = expr.split(/ AND | OR /);
  const parts = [];
  const upstream = UPSTREAM_TEXT.find(([k]) => coord.startsWith(k))?.[1];
  if (upstream) parts.push(read(join(root, 'scripts/licence-texts', upstream)).trim());
  else if (ids.some((id) => /^(MIT|BSD)/.test(id))) { console.error(`Android library ${coord} is ${expr} and needs its upstream LICENSE in scripts/licence-texts (UPSTREAM_TEXT)`); process.exit(1); }
  if (ids.includes('Apache-2.0')) parts.push(SPDX_TEXT['Apache-2.0']);
  return parts.length ? textId(parts.join('\n\n----------\n\n')) : null;
};
const licenceUrl = (expr) => LICENCE_URL[expr] ?? expr.split(/ AND | OR /).map((id) => LICENCE_URL[id.split(' ')[0]]).filter(Boolean)[0] ?? null;

// Versions the Gradle files take from the host app or a BOM instead of declaring them. 
const VERSION_VARS = { kotlinVersion: 'kotlin', kotlin_version: 'kotlin' }; // names in React Native's libs.versions.toml
const MANUAL_VERSIONS = { 'io.github.expo.kolibri:kolibri-android': '0.2.3' }; // no version in the Gradle file; Expo's BOM pins it (Maven Central latest 0.2.3)

const toml = read(join(nm, 'react-native/gradle/libs.versions.toml'));
const tomlVersions = Object.fromEntries([...toml.split('[libraries]')[0].matchAll(/^([\w-]+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
const tomlVersionVars = { FRESCO_VERSION: tomlVersions.fresco };

const native = new Map();
const addNative = (coord, version, from) => {
  if (coord.startsWith('com.facebook.react:')) return; // React Native itself, listed as the react-native npm package
  const licence = nativeLicence(coord);
  if (!licence) { console.error(`Android library ${coord} (from ${from}) has no licence in scripts/licences.mjs`); process.exit(1); }
  const key = `${coord}:${version}`;
  const prev = native.get(key);
  native.set(key, { name: coord, version, licence, url: licenceUrl(licence), text: licenceText(coord, licence), from: [...new Set([...(prev?.from ?? []), from])].sort() });
};
const resolveVersion = (coord, v, gradle, from) => {
  if (v === undefined) {
    if (coord in MANUAL_VERSIONS) return MANUAL_VERSIONS[coord];
    console.error(`Android library ${coord} (from ${from}) declares no version: add it to MANUAL_VERSIONS in scripts/licences.mjs`);
    process.exit(1);
  }
  const ref = v.match(/^\$\{?(\w+)\}?$/)?.[1];
  if (!ref) return v;
  const def = gradle.match(new RegExp(`(?:def|ext\\.|val)\\s*${ref}\\s*=\\s*["']([^"']+)["']`))?.[1];
  const resolved = def ?? (VERSION_VARS[ref] ? tomlVersions[VERSION_VARS[ref]] : undefined) ?? tomlVersionVars[ref];
  if (!resolved) { console.error(`Android library ${coord} (from ${from}) uses version variable ${ref} that scripts/licences.mjs cannot resolve`); process.exit(1); }
  return resolved;
};
for (const p of packages) {
  const f = join(dirOf.get(`${p.name}@${p.version}`), 'android/build.gradle');
  if (!existsSync(f)) continue;
  const gradle = read(f);
  for (const m of gradle.matchAll(/^\s*(?:api|implementation)\s*\(?\s*["']([\w.-]+:[\w.-]+)(?::([^"':]+))?["']/gm)) { if (m[1].startsWith("com.facebook.react:")) continue; addNative(m[1], resolveVersion(m[1], m[2], gradle, p.name), p.name); }
}
const catalogue = toml.split('[libraries]')[1].split('[plugins]')[0];
const SKIP = /^(junit|assertj|mockito|robolectric|thoughtworks|androidx-test|androidx-espresso|androidx-junit|androidx-uiautomator|androidx-benchmark|jsc-android)/;
for (const m of catalogue.matchAll(/^([\w-]+)\s*=\s*\{[^}]*?(?:module\s*=\s*"([^"]+)"|group\s*=\s*"([^"]+)",\s*name\s*=\s*"([^"]+)")[^}]*version\.ref\s*=\s*"([^"]+)"/gm)) {
  if (SKIP.test(m[1])) continue;
  addNative(m[2] ?? `${m[3]}:${m[4]}`, tomlVersions[m[5]], 'react-native');
}
const android = [...native.values()].sort((a, b) => (a.name + (a.version ?? '')).localeCompare(b.name + (b.version ?? '')));

// Bundled fonts and icons
const MIT_IONIC = 'MIT License\n\nCopyright (c) 2015-present Ionic (http://ionic.io/)\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
const assets = [
  { name: 'Inter (font)', version: null, licence: 'OFL-1.1', url: 'https://github.com/rsms/inter', text: textId(read(join(root, 'public/licenses/Inter-OFL-1.1.txt'))) },
  { name: 'Roboto (font)', version: null, licence: 'OFL-1.1', url: 'https://github.com/googlefonts/roboto-classic', text: textId(read(join(root, 'public/licenses/Roboto-OFL-1.1.txt'))) },
  { name: 'Ionicons (icons)', version: null, licence: 'MIT', url: 'https://github.com/ionic-team/ionicons', text: textId(MIT_IONIC) },
];

const sortedTexts = Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)));
const out = `${JSON.stringify({ packages, android, assets, texts: sortedTexts })}\n`;
if (check) {
  if (!existsSync(outFile) || read(outFile) !== out) { console.error('src/about/licences.json is stale: run `node scripts/licences.mjs` in apps/mobile after npm ci'); process.exit(1); }
  console.log(`licences.json is current (${packages.length} npm, ${android.length} Android, ${assets.length} assets)`);
} else {
  writeFileSync(outFile, out);
  console.log(`wrote ${outFile}: ${packages.length} npm, ${android.length} Android, ${assets.length} assets, ${Object.keys(texts).length} texts`);
}
