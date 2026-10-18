/** @jest-environment node */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// #944: the web barcode reader's .wasm is our own file with its licences next to it, the ponyfill never reaches a CDN, and the
// Content-Security-Policy needs no loosening for it (script-src keeps 'wasm-unsafe-eval' and nothing else).
const overrides: { locateFile?: (path: string, prefix: string) => string }[] = [];
jest.mock('barcode-detector/ponyfill', () => ({ BarcodeDetector: class {}, setZXingModuleOverrides: (o: { locateFile: (p: string, x: string) => string }) => void overrides.push(o) }));

const app = join(__dirname, '..');
const dir = join(app, 'public/zxing');
const read = (p: string) => readFileSync(p, 'utf8');
const wasmDir = join(dir, '3.1.3');
const wasm = readFileSync(join(wasmDir, 'zxing_reader.wasm'));
const sha = createHash('sha256').update(wasm).digest('hex');

describe('self-hosted zxing reader', () => {
  it('ships the wasm and its licence, and nothing else', () => {
    expect(readdirSync(dir).sort()).toEqual(['3.1.3', 'LICENSE.txt']);
    expect(readdirSync(wasmDir)).toEqual(['zxing_reader.wasm']); // the folder name is the zxing-wasm version (see the next test)
  });

  it('the wasm is the one in the pinned npm package, and its sha256 is in the licence file', () => {
    const pkg = join(app, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
    if (existsSync(pkg)) expect(readFileSync(pkg).equals(wasm)).toBe(true);
    expect(read(join(dir, 'LICENSE.txt'))).toContain(`${sha}  3.1.3/zxing_reader.wasm`);
    expect(wasm.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d])); // "\0asm"
  });

  it('the licence file carries the MIT text, the Apache-2.0 text, ZXing-C++ and libzueci', () => {
    const lic = read(join(dir, 'LICENSE.txt'));
    for (const s of ['MIT License', 'Ze-Zheng Wu', 'Emscripten', 'Apache License', 'Version 2.0, January 2004', 'zxing-cpp', 'Nu-book Inc.', 'libzueci', 'BSD-3-Clause']) expect(lic).toContain(s);
  });

  it('pins barcode-detector and zxing-wasm exactly, and zxing-wasm is the version barcode-detector was built against', () => {
    const deps = JSON.parse(read(join(app, 'package.json'))).dependencies as Record<string, string>;
    expect(deps['barcode-detector']).toBe('3.2.2');
    expect(deps['zxing-wasm']).toBe('3.1.3');
    const bd = join(app, 'node_modules/barcode-detector/package.json');
    if (existsSync(bd)) expect(JSON.parse(read(bd)).dependencies['zxing-wasm']).toBe(deps['zxing-wasm']);
    // barcode-detector inlines its own copy of the zxing-wasm glue, which names its version: a bump that changes the glue without the wasm fails here
    const glue = join(app, 'node_modules/barcode-detector/dist/es/zxing-exported.js');
    if (existsSync(glue)) expect(read(glue)).toContain(`zxing-wasm@${deps['zxing-wasm']}`);
    // the served folder is the version
    expect(existsSync(join(dir, deps['zxing-wasm'] as string, 'zxing_reader.wasm'))).toBe(true);
  });
});

describe('the web build picks the web view', () => {
  it('index.web.ts exists and index.web.tsx does not: Metro tries .ts before the platform suffix of .tsx, so a .tsx would lose to index.ts (the native view)', () => {
    const files = readdirSync(join(app, 'modules/plate-barcode-scanner'));
    expect(files).toContain('index.web.ts');
    expect(files).not.toContain('index.web.tsx');
    expect(read(join(app, 'modules/plate-barcode-scanner/index.web.ts'))).toContain('BarcodeScannerView');
  });
});

describe('the ponyfill never reaches a third party', () => {
  it('locates the .wasm on our own origin, and any other file under the default prefix', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/barcode/zxing-decoder');
    const locate = overrides[0]!.locateFile!;
    expect(locate('zxing_reader.wasm', 'https://cdn.example/')).toBe('/zxing/3.1.3/zxing_reader.wasm');
    expect(locate('other.js', 'https://app.test/')).toBe('https://app.test/other.js');
  });

  it('no source of the scanner names a CDN', () => {
    const src = join(app, 'src/barcode');
    for (const f of readdirSync(src)) expect({ f, hit: /jsdelivr|unpkg|cdnjs|googleapis|gstatic/.exec(read(join(src, f)))?.[0] }).toEqual({ f, hit: undefined });
  });

  it('the CSP (Pages file and Caddy) is the one that shipped for pose tracking: wasm-unsafe-eval only, no blob: or unsafe-eval script, no new origin', () => {
    for (const f of [join(app, 'public/_headers'), join(app, '../../infra/caddy/Caddyfile.web')]) {
      const csp = /Content-Security-Policy:?\s*"?(default-src[^"\n]*)/.exec(read(f))?.[1] ?? '';
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
      expect(/script-src[^;]*(blob:|'unsafe-eval'|'unsafe-inline')/.test(csp)).toBe(false);
      expect(csp).toContain("connect-src 'self'");
      expect(/jsdelivr|unpkg|cdn/.test(csp)).toBe(false);
    }
  });

  it('the scanner flag is not set anywhere a build reads by default', () => {
    for (const f of ['.env', '.env.production', '.env.local', 'eas.json']) {
      const p = join(app, f);
      if (existsSync(p)) expect(read(p)).not.toContain('EXPO_PUBLIC_BARCODE_SCAN');
    }
    expect(read(join(app, 'app.json'))).not.toContain('BARCODE_SCAN');
  });
});
