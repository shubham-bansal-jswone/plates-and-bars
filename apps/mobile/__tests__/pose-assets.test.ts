/** @jest-environment node */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// #947: the model weights and the WASM runtime are our own files, with their licence next to them, and nothing reaches a third party.
const app = join(__dirname, '..');
const model = join(app, 'public/pose/movenet-lightning');
const sha = (f: string) => createHash('sha256').update(readFileSync(join(model, f))).digest('hex');
const read = (p: string) => readFileSync(p, 'utf8');

describe('self-hosted MoveNet Lightning weights', () => {
  const manifest = JSON.parse(read(join(model, 'model.json'))).weightsManifest as { paths: string[] }[];
  const shards = manifest.flatMap((g) => g.paths);

  it('model.json names shards that sit next to it, by relative path (no other host)', () => {
    expect(shards).toEqual(['group1-shard1of2.bin', 'group1-shard2of2.bin']);
    for (const s of shards) expect(existsSync(join(model, s))).toBe(true);
  });

  it('every file matches the sha256 pinned in its licence file, and the shards match the compatibility spike on #947', () => {
    const lic = read(join(model, 'LICENSE.txt'));
    for (const f of ['model.json', ...shards]) expect(lic).toContain(`${sha(f)}  ${f}`);
    expect(sha('group1-shard1of2.bin')).toMatch(/^b42c3232.*bea2$/);
    expect(sha('group1-shard2of2.bin')).toMatch(/^8253ab96.*b6dc$/);
  });

  it('ships the Apache-2.0 text with the source and the model card', () => {
    const lic = read(join(model, 'LICENSE.txt'));
    expect(lic).toContain('Apache License');
    expect(lic).toContain('Version 2.0, January 2004');
    expect(lic).toContain('kaggle.com/models/google/movenet/TfJs/singlepose-lightning');
    expect(lic).toContain('MoveNet.SinglePose%20Model%20Card.pdf');
  });

  it('the single-thread WASM files are there, with their licences, and the threaded one is not', () => {
    const dir = join(app, 'public/pose/wasm');
    expect(readdirSync(dir).sort()).toEqual(['LICENSE.txt', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm.wasm']);
    const lic = read(join(dir, 'LICENSE.txt'));
    for (const name of ['Apache License', 'XNNPACK', 'Emscripten', 'pthreadpool', 'cpuinfo']) expect(lic).toContain(name);
  });
});

describe('nothing in the pose code or the policy reaches a third party', () => {
  it('no source names the library default model host or any CDN', () => {
    const dir = join(app, 'src/pose');
    for (const f of readdirSync(dir)) expect({ f, hit: /tfhub\.dev|kaggle\.com|jsdelivr|unpkg|storage\.googleapis/.exec(read(join(dir, f)))?.[0] }).toEqual({ f, hit: undefined });
  });

  it('the CSP (Pages file and Caddy) does not allow blob: scripts or any new origin for the model', () => {
    const files = [join(app, 'public/_headers'), join(app, '../../infra/caddy/Caddyfile.web')];
    for (const f of files) {
      const csp = /Content-Security-Policy:?\s*"?(default-src[^"\n]*)/.exec(read(f))?.[1] ?? '';
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
      expect(/script-src[^;]*blob:/.test(csp)).toBe(false);
      expect(/tfhub|kaggle|jsdelivr|googleapis/.test(csp)).toBe(false);
    }
  });

  it('pins the TensorFlow.js packages to the versions checked in the spike, exactly', () => {
    const deps = JSON.parse(read(join(app, 'package.json'))).dependencies as Record<string, string>;
    expect(deps['@tensorflow-models/pose-detection']).toBe('2.1.3');
    for (const p of ['tfjs-core', 'tfjs-converter', 'tfjs-backend-webgl', 'tfjs-backend-wasm']) expect(deps[`@tensorflow/${p}`]).toBe('4.22.0');
  });

  it('the feature flag is not set anywhere a build reads by default', () => {
    for (const f of ['.env', '.env.production', '.env.local', 'eas.json']) {
      const p = join(app, f);
      if (existsSync(p)) expect(read(p)).not.toContain('EXPO_PUBLIC_POSE_TRACKING');
    }
    expect(read(join(app, 'app.json'))).not.toContain('POSE_TRACKING');
  });
});
