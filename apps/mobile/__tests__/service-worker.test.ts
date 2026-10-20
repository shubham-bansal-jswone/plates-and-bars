/** @jest-environment node */
// The offline service worker (#718): what it caches, what it never touches, and that a half-built cache is not used.
/* eslint-disable @typescript-eslint/no-require-imports */
const sw = require('../public/sw.js');

const ORIGIN = 'https://app.test';
const ENTRY = '/_expo/static/js/web/entry-abc123.js';
const WORKER = '/_expo/static/js/web/worker-def456.js';
const FONT = '/assets/node_modules/f/Inter.0a1b.ttf';
const HTML = `<html><link rel="icon" href="/favicon.ico"/><script src="${ENTRY}" defer></script></html>`;

class FakeCache {
  m = new Map<string, Response>();
  async match(k: string) {
    return this.m.get(k)?.clone();
  }
  async put(k: string, r: Response) {
    this.m.set(k, r.clone());
  }
  async add(k: string) {
    this.m.set(k, new Response('x'));
  }
}
function install(files: Record<string, string>, stores = new Map<string, FakeCache>()) {
  const fetched: string[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.caches = {
    has: async (n: string) => stores.has(n),
    open: async (n: string) => stores.get(n) ?? stores.set(n, new FakeCache()).get(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  g.fetch = async (r: string | Request) => {
    const path = typeof r === 'string' ? r : new URL(r.url).pathname;
    fetched.push(path);
    return path in files ? new Response(files[path], { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' } }) : new Response('', { status: 404 });
  };
  return { stores, fetched };
}

describe('service worker helpers', () => {
  it('never handles API or auth paths, or other origins', () => {
    expect(sw.cacheable(`${ORIGIN}/api/v1/sync`, ORIGIN)).toBe(false);
    expect(sw.cacheable(`${ORIGIN}/auth/refresh`, ORIGIN)).toBe(false);
    expect(sw.cacheable('https://api.test/assets/x.png', ORIGIN)).toBe(false);
    expect(sw.cacheable(`${ORIGIN}/assets/x.png`, ORIGIN)).toBe(true);
  });
  it('finds hashed paths in html and bundles, and names the cache from the entry bundle', () => {
    expect(sw.assetPaths(`${HTML} a("${WORKER}") b('${FONT}') c(/assets/z.png) d(\`/assets/q.png\`)`).sort()).toEqual([ENTRY, WORKER, FONT, '/assets/z.png', '/assets/q.png'].sort());
    expect(sw.versionOf(HTML)).toBe(`pb-shell-${ENTRY}`);
    expect(sw.versionOf('<html></html>')).toBeNull();
  });
});

describe('precache and fetch', () => {
  const files = { '/': HTML, [ENTRY]: `x("${WORKER}")`, [WORKER]: `y("${FONT}")`, [FONT]: 'f' };

  it('caches the shell with the response headers, then serves it when the network is down', async () => {
    const { stores } = install(files);
    await sw.precache();
    const cache = stores.get(`pb-shell-${ENTRY}`)!;
    expect([...cache.m.keys()].sort()).toEqual(['/', ENTRY, FONT, WORKER].sort());
    expect((await cache.match('/'))!.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    (globalThis as unknown as { fetch: unknown }).fetch = async () => {
      throw new Error('offline');
    };
    const nav = await sw.onFetch({ mode: 'navigate', url: `${ORIGIN}/progress` }, ORIGIN, () => {});
    expect(await nav.text()).toBe(HTML);
    const asset = await sw.onFetch({ mode: 'no-cors', url: `${ORIGIN}${FONT}` }, ORIGIN, () => {});
    expect(await asset.text()).toBe('f');
  });

  it('the install and the first navigation building at once end with one complete cache and never build at the same time', async () => {
    const { stores } = install(files);
    // Count the concurrent `/` reads of a build: the second `precache()` has to wait for the first (#718), otherwise the
    // two builds can delete each other's half-built cache. Without the queue this reaches 2.
    let reads = 0;
    let most = 0;
    const real = (globalThis as unknown as { fetch: (r: string | Request) => Promise<Response> }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (r: string | Request) => {
      if ((typeof r === 'string' ? r : new URL(r.url).pathname) === '/') {
        reads += 1;
        most = Math.max(most, reads);
        await new Promise((done) => setImmediate(done));
        reads -= 1;
      }
      return real(r);
    };
    await Promise.all([sw.precache(), sw.precache()]);
    expect(most).toBe(1);
    expect([...stores.get(`pb-shell-${ENTRY}`)!.m.keys()].sort()).toEqual(['/', ENTRY, FONT, WORKER].sort());
  });

  it('never precaches the pose tracking chunks or the model weights (on demand only, #947)', async () => {
    const POSE = '/_expo/static/js/web/pose-session-aa11.js';
    const DETECTOR = '/_expo/static/js/web/pose-detector-bb22.js';
    const withPose = { ...files, [ENTRY]: `x("${WORKER}");import("${POSE}");load("${DETECTOR}");m("/pose/movenet-lightning/model.json");w("/pose/wasm/tfjs-backend-wasm.wasm")` };
    const { stores, fetched } = install(withPose);
    await sw.precache();
    expect([...stores.get(`pb-shell-${ENTRY}`)!.m.keys()].sort()).toEqual(['/', ENTRY, FONT, WORKER].sort());
    expect(fetched.filter((p) => p.includes('pose'))).toEqual([]);
    expect(sw.assetPaths(`a("${POSE}") b("${DETECTOR}") c("${WORKER}")`)).toEqual([WORKER]);
  });

  it('never precaches the web barcode reader chunk or its .wasm (on demand only, #944)', async () => {
    const ZX = '/_expo/static/js/web/zxing-decoder-cc33.js';
    const withZx = { ...files, [ENTRY]: `x("${WORKER}");import("${ZX}");w("/zxing/3.1.3/zxing_reader.wasm")` };
    const { stores, fetched } = install(withZx);
    await sw.precache();
    expect([...stores.get(`pb-shell-${ENTRY}`)!.m.keys()].sort()).toEqual(['/', ENTRY, FONT, WORKER].sort());
    expect(fetched.filter((p) => p.includes('zxing'))).toEqual([]);
    expect(sw.assetPaths(`a("${ZX}") c("${WORKER}")`)).toEqual([WORKER]);
  });

  it('never precaches the label OCR chunk or its worker, core and language data (on demand only, #1067)', async () => {
    const TE = '/_expo/static/js/web/tesseract-engine-dd44.js';
    const withTe = { ...files, [ENTRY]: `x("${WORKER}");import("${TE}");w("/tesseract/js-7.0.0/worker.min.js");c("/tesseract/core-7.0.0/tesseract-core-lstm.wasm.js")` };
    const { stores, fetched } = install(withTe);
    await sw.precache();
    expect([...stores.get(`pb-shell-${ENTRY}`)!.m.keys()].sort()).toEqual(['/', ENTRY, FONT, WORKER].sort());
    expect(fetched.filter((p) => p.includes('tesseract'))).toEqual([]);
    expect(sw.assetPaths(`a("${TE}") c("${WORKER}")`)).toEqual([WORKER]);
  });

  it('a pose chunk is fetched from the network when asked for, and not stored', async () => {
    const POSE = '/_expo/static/js/web/pose-session-aa11.js';
    const { stores } = install({ ...files, [POSE]: 'chunk' });
    await sw.precache();
    const res = await sw.onFetch({ mode: 'no-cors', url: `${ORIGIN}${POSE}` }, ORIGIN, () => {});
    expect(await res.text()).toBe('chunk');
    expect(stores.get(`pb-shell-${ENTRY}`)!.m.has(POSE)).toBe(false);
  });

  it('a failed download leaves no cache, so the previous one stays in use', async () => {
    const { stores } = install({ '/': HTML, [ENTRY]: `y("${FONT}")` }); // the font is a 404
    await expect(sw.precache()).rejects.toThrow();
    expect(stores.size).toBe(0);
  });

  it('a new deploy replaces the old cache once it is complete', async () => {
    const { stores } = install(files);
    await sw.precache();
    const ENTRY2 = '/_expo/static/js/web/entry-new999.js';
    install({ '/': HTML.replace(ENTRY, ENTRY2), [ENTRY2]: '' }, stores);
    await sw.precache();
    expect([...stores.keys()]).toEqual([`pb-shell-${ENTRY2}`]);
  });
});
