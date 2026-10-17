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
//     Licences come from the table below; an unknown library fails the script so it cannot be listed without a licence.
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

const noticeFile = (dir) => {
  const f = readdirSync(dir).filter((n) => /^(licen[sc]e|copying|unlicen[sc]e)(\.(md|txt|markdown))?$/i.test(n)).sort();
  return f.length ? read(join(dir, f[0])) : null;
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
for (const [path, e] of Object.entries(lock)) {
  if (!path || e.dev || e.optional || e.link || e.os || e.cpu || !path.includes('node_modules/')) continue;
  const dir = join(root, path);
  if (!existsSync(join(dir, 'package.json'))) { missing.push(path); continue; }
  const p = readJson(join(dir, 'package.json'));
  const licence = licenceOf(p) || e.license;
  if (!licence) { console.error(`no licence recorded for ${p.name}@${p.version}`); process.exit(1); }
  const text = noticeFile(dir);
  npm.set(`${p.name}@${p.version}`, { name: p.name, version: p.version, licence, url: repoUrl(p.repository) ?? p.homepage ?? null, text: text ? textId(text) : null });
}
if (missing.length) { console.error(`not installed (run npm ci): ${missing.slice(0, 5).join(', ')}`); process.exit(1); }
const packages = [...npm.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

// Android libraries
const NATIVE_LICENCE = {
  'androidx.': 'Apache-2.0',
  'com.google.android.material:': 'Apache-2.0',
  'org.jetbrains.kotlin': 'Apache-2.0',
  'org.jetbrains.kotlinx:': 'Apache-2.0',
  'com.squareup.': 'Apache-2.0',
  'com.google.code.gson:': 'Apache-2.0',
  'commons-io:': 'Apache-2.0',
  'commons-codec:': 'Apache-2.0',
  'javax.inject:': 'Apache-2.0',
  'javax.annotation:': 'CDDL-1.1 OR GPL-2.0-only WITH Classpath-exception-2.0',
  'com.google.code.findbugs:jsr305': 'BSD-3-Clause',
  'com.github.bumptech.glide:': 'BSD-2-Clause AND MIT AND Apache-2.0',
  'com.facebook.': 'MIT',
  'io.github.expo': 'MIT',
  'org.brotli:': 'MIT',
  'com.vanniktech:': 'Apache-2.0',
};
const licenceFor = (coord) => Object.entries(NATIVE_LICENCE).find(([k]) => coord.startsWith(k))?.[1];
const native = new Map();
const addNative = (coord, version, from) => {
  const licence = licenceFor(coord);
  if (!licence) { console.error(`Android library ${coord} (from ${from}) has no licence in scripts/licences.mjs`); process.exit(1); }
  const key = `${coord}:${version}`;
  const prev = native.get(key);
  native.set(key, { name: coord, version, licence, from: [...new Set([...(prev?.from ?? []), from])].sort() });
};
const prodDirs = packages.map((p) => ({ p, dir: join(nm, p.name) })).filter((x) => existsSync(join(x.dir, 'android/build.gradle')));
for (const { p, dir } of prodDirs) {
  const gradle = read(join(dir, 'android/build.gradle'));
  for (const m of gradle.matchAll(/^\s*(?:api|implementation)\s*\(?\s*["']([\w.-]+:[\w.-]+):(\d[\w.-]*)["']/gm)) addNative(m[1], m[2], p.name);
}
const toml = read(join(nm, 'react-native/gradle/libs.versions.toml'));
const versions = Object.fromEntries([...toml.split('[libraries]')[0].matchAll(/^([\w-]+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
const SKIP = /^(junit|assertj|mockito|robolectric|thoughtworks|androidx-test|androidx-espresso|androidx-junit|androidx-uiautomator|androidx-benchmark|jsc-android)/;
for (const m of toml.split('[libraries]')[1].split('[plugins]')[0].matchAll(/^([\w-]+)\s*=\s*\{[^}]*?(?:module\s*=\s*"([^"]+)"|group\s*=\s*"([^"]+)",\s*name\s*=\s*"([^"]+)")[^}]*version\.ref\s*=\s*"([^"]+)"/gm)) {
  if (SKIP.test(m[1])) continue;
  addNative(m[2] ?? `${m[3]}:${m[4]}`, versions[m[5]], 'react-native');
}
const android = [...native.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

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
