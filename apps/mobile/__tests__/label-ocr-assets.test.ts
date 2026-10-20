/** @jest-environment node */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_PATH, LANG_PATH, TESSDATA_VERSION, TESSERACT_CORE_VERSION, TESSERACT_JS_VERSION, TRAINEDDATA_SHA256, WORKER_PATH } from '../src/labelscan/webAssets';

// #1067, ADR 010: the language data, the web engine files and the native module are pinned, licensed, on our own origin, and keep the image on the device.
const app = join(__dirname, '..');
const read = (p: string) => readFileSync(p, 'utf8');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mod = join(app, 'modules/plate-label-scanner');
const kt = join(mod, 'android/src/main/java/app/plateandbar/labelscan');

describe('eng.traineddata (tessdata_fast)', () => {
  const android = join(mod, 'android/src/main/assets/eng.traineddata');
  const web = join(app, 'public/tesseract', `tessdata-fast-${TESSDATA_VERSION}`, 'eng.traineddata');
  it('is one file with one pinned hash: the Android asset, the web file, the Kotlin pin and the JavaScript pin', () => {
    expect(readFileSync(android).length).toBe(4_113_088);
    expect(sha(android)).toBe(TRAINEDDATA_SHA256);
    expect(sha(web)).toBe(TRAINEDDATA_SHA256);
    expect(read(join(kt, 'TessData.kt'))).toContain(`const val SHA256 = "${TRAINEDDATA_SHA256}"`);
  });
  it('has its licence next to the module with the source, the hash and the Apache-2.0 text', () => {
    const lic = read(join(mod, 'DATA-LICENSE.txt'));
    for (const s of [TRAINEDDATA_SHA256, 'tessdata_fast', '4.1.0', 'Version 2.0, January 2004']) expect(lic).toContain(s);
  });
});

describe('self-hosted web engine', () => {
  const dir = join(app, 'public/tesseract');
  it('ships the worker, the three LSTM cores, the data and the licence, and nothing else', () => {
    const all: string[] = [];
    const walk = (d: string, p = '') => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n), `${p}${n}/`) : all.push(`${p}${n}`)));
    walk(dir);
    expect(all.sort()).toEqual([
      'LICENSE.txt',
      `core-${TESSERACT_CORE_VERSION}/tesseract-core-lstm.wasm.js`,
      `core-${TESSERACT_CORE_VERSION}/tesseract-core-relaxedsimd-lstm.wasm.js`,
      `core-${TESSERACT_CORE_VERSION}/tesseract-core-simd-lstm.wasm.js`,
      `js-${TESSERACT_JS_VERSION}/worker.min.js`,
      `tessdata-fast-${TESSDATA_VERSION}/eng.traineddata`,
    ]);
    expect(WORKER_PATH).toBe(`/tesseract/js-${TESSERACT_JS_VERSION}/worker.min.js`);
    expect(CORE_PATH).toBe(`/tesseract/core-${TESSERACT_CORE_VERSION}/`);
    expect(LANG_PATH).toBe(`/tesseract/tessdata-fast-${TESSDATA_VERSION}/`);
  });
  it('the files are the ones in the pinned npm packages, and their sha256 is in the licence file', () => {
    const lic = read(join(dir, 'LICENSE.txt'));
    const pairs: [string, string][] = [
      [`js-${TESSERACT_JS_VERSION}/worker.min.js`, 'node_modules/tesseract.js/dist/worker.min.js'],
      ...['', 'simd-', 'relaxedsimd-'].map((v): [string, string] => [`core-${TESSERACT_CORE_VERSION}/tesseract-core-${v}lstm.wasm.js`, `node_modules/tesseract.js-core/tesseract-core-${v}lstm.wasm.js`]),
    ];
    for (const [served, pkg] of pairs) {
      expect(lic).toContain(`${sha(join(dir, served))}  ${served}`);
      if (existsSync(join(app, pkg))) expect(readFileSync(join(app, pkg)).equals(readFileSync(join(dir, served)))).toBe(true);
    }
    expect(lic).toContain(`${TRAINEDDATA_SHA256}  tessdata-fast-${TESSDATA_VERSION}/eng.traineddata`);
  });
  it('the licence file carries Apache-2.0, Leptonica, IJG, libpng, libtiff, libwebp, giflib, zlib, openlibm, Emscripten and the worker\'s bundled MIT parts', () => {
    const lic = read(join(dir, 'LICENSE.txt'));
    for (const s of ['Version 2.0, January 2004', 'Leptonica', 'Independent JPEG Group', 'PNG Reference Library License', 'LibTIFF', 'Google Inc.', 'Eric S. Raymond', 'Jean-loup Gailly', 'OpenLibm', 'Emscripten authors', 'Feross', 'Fair Oaks Labs', 'imaya']) expect(lic).toContain(s);
  });
  it('pins tesseract.js and its core exactly, and tesseract.js depends on that core major', () => {
    const deps = JSON.parse(read(join(app, 'package.json'))).dependencies as Record<string, string>;
    expect(deps['tesseract.js']).toBe(TESSERACT_JS_VERSION);
    expect(deps['tesseract.js-core']).toBe(TESSERACT_CORE_VERSION);
    const pkg = join(app, 'node_modules/tesseract.js/package.json');
    if (existsSync(pkg)) expect(JSON.parse(read(pkg)).dependencies['tesseract.js-core']).toMatch(/^\^7\./);
  });
});

describe('never a third party', () => {
  it('no source of the scanner names a CDN or a remote address', () => {
    const files = [join(app, 'src/labelscan'), join(mod)];
    const list: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => { const p = join(d, n); if (n === 'build' || n === 'assets') return; if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|kt|gradle)$/.test(n)) list.push(p); });
    files.forEach(walk);
    for (const f of list) expect({ f, hit: /jsdelivr|unpkg|cdnjs|googleapis|gstatic|https?:\/\/(?!www\.apache\.org|github\.com)/.exec(read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''))?.[0] }).toEqual({ f, hit: undefined });
  });
  it('the CSP is unchanged: wasm-unsafe-eval only, same-origin workers, no new origin', () => {
    for (const f of [join(app, 'public/_headers'), join(app, '../../infra/caddy/Caddyfile.web')]) {
      const csp = /Content-Security-Policy:?\s*"?(default-src[^"\n]*)/.exec(read(f))?.[1] ?? '';
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
      expect(csp).toContain("worker-src 'self'");
      expect(/script-src[^;]*(blob:|'unsafe-eval'|'unsafe-inline')/.test(csp)).toBe(false);
      expect(/jsdelivr|unpkg|cdn/.test(csp)).toBe(false);
    }
  });
  it('the flag is not set anywhere a build reads by default', () => {
    for (const f of ['.env', '.env.production', '.env.local', 'eas.json']) if (existsSync(join(app, f))) expect(read(join(app, f))).not.toContain('EXPO_PUBLIC_LABEL_SCAN');
    expect(read(join(app, 'app.json'))).not.toContain('LABEL_SCAN');
  });
});

describe('the module registration and build', () => {
  it('index.web.ts exists and index.web.tsx does not (Metro would pick index.ts over a .tsx web file)', () => {
    const files = readdirSync(mod);
    expect(files).toContain('index.web.ts');
    expect(files).not.toContain('index.web.tsx');
  });
  it('registers the Kotlin module for Android', () => {
    expect(JSON.parse(read(join(mod, 'expo-module.config.json')))).toEqual({ platforms: ['android'], android: { modules: ['app.plateandbar.labelscan.LabelScannerModule'] } });
  });
  it('uses the vendored Tesseract4Android AAR from a repository limited to its group, not JitPack, and lint fails the build', () => {
    const g = read(join(mod, 'android/build.gradle'));
    expect(g).toContain("implementation 'app.plateandbar.vendor:tesseract4android:4.9.0'");
    expect(g).toContain("includeGroup 'app.plateandbar.vendor'");
    expect(g).toContain('$projectDir/libs-maven');
    expect(g).toContain('rootProject.allprojects');
    expect(g).toContain('exclusiveContent');
    expect(g.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/jitpack|mavenCentral|google\(\)/i);
    expect(g).toContain('abortOnError true');
    expect(g).not.toMatch(/mlkit|play-services|firebase/i);
  });
  it('the vendored AAR is the pinned file, built from the pinned upstream commit', () => {
    const dir = join(mod, 'android/libs-maven/app/plateandbar/vendor/tesseract4android/4.9.0');
    expect(readdirSync(dir).sort()).toEqual(['tesseract4android-4.9.0.aar', 'tesseract4android-4.9.0.pom']);
    const aarSha = '783b1a4ca5dfdcc4d4a6847fbfcedd24728d388e9657ec59531bfd5bf4d67352';
    expect(sha(join(dir, 'tesseract4android-4.9.0.aar'))).toBe(aarSha);
    expect(read(join(mod, 'android/src/test/java/app/plateandbar/labelscan/VendoredAarTest.kt'))).toContain(aarSha);
    const commit = 'd7de990ef78f70d553e327b98b3992d11863f134';
    for (const f of [join(mod, 'android/build.gradle'), join(mod, 'android/libs-maven/README.md'), join(app, '../../infra/scripts/build-tesseract4android.sh'), join(app, 'scripts/licences.mjs')]) expect(read(f)).toContain(commit);
    expect(read(join(mod, 'android/libs-maven/README.md'))).toContain(aarSha);
  });
  it('declares no permission', () => {
    expect(read(join(mod, 'android/src/main/AndroidManifest.xml'))).not.toContain('<uses-permission');
  });
  it('CI runs the module unit tests and lint, and the OCR flag is mapped like the other two', () => {
    const wf = read(join(app, '../../.github/workflows/android-release.yml'));
    expect(wf).toContain(':plate-label-scanner:testDebugUnitTest :plate-label-scanner:lintDebug');
    expect(wf).toContain("EXPO_PUBLIC_LABEL_SCAN: ${{ github.event_name != 'pull_request' && vars.EXPO_PUBLIC_LABEL_SCAN || '' }}");
    expect(read(join(app, '../../.github/workflows/web-deploy.yml'))).toContain('EXPO_PUBLIC_LABEL_SCAN: ${{ vars.EXPO_PUBLIC_LABEL_SCAN }}');
  });
});

describe('the native module keeps the image on the device', () => {
  const sources = readdirSync(kt).map((f) => [f, read(join(kt, f))] as const);
  it('has the expected source files', () => {
    expect(sources.map(([f]) => f).sort()).toEqual(['Errors.kt', 'Geometry.kt', 'ImageLoader.kt', 'LabelScannerModule.kt', 'LineBuilder.kt', 'Recognizer.kt', 'TessData.kt', 'Turn.kt']);
  });
  it('no source can send, encode, store or log an image or text (no network, compress, media store, log, error reporter)', () => {
    const banned = /java\.net|HttpURLConnection|okhttp|Socket|URL\(|compress\(|MediaStore|ImageCapture|Log\.|println|Sentry|FileOutputStream|\.writeBytes|\.writeText|openFileOutput|createTempFile\(\s*"?[^A]/;
    for (const [f, text] of sources) expect({ f, hit: banned.exec(text)?.[0] }).toEqual({ f, hit: undefined });
  });
  it('writes a file in one place only: the language-data copy in TessData.kt', () => {
    for (const [f, text] of sources) expect({ f, writes: /outputStream\(|copyTo\(/.test(text) }).toEqual({ f, writes: f === 'TessData.kt' });
  });
  it('only content and file addresses are opened, and the engine is freed after every scan', () => {
    expect(read(join(kt, 'ImageLoader.kt'))).toContain('uri.scheme != "content" && uri.scheme != "file"');
    const r = read(join(kt, 'Recognizer.kt'));
    expect(r).toContain('api?.recycle()');
    expect(r).toContain('bitmap.recycle()');
  });
});
