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
    expect(sw.assetPaths(`${HTML} a("${WORKER}") b('${FONT}') c(/assets/z.png)`).sort()).toEqual([ENTRY, WORKER, FONT, '/assets/z.png'].sort());
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
