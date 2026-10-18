// Plate & Bar service worker (#718): the web app starts offline after a cold reload.
// Hand-written, no dependency. Copied verbatim into dist/ by `expo export`, so it cannot know the hashed file names at
// build time: it learns them from the live index.html (see precache). The cache is named after the entry bundle, so a
// deploy gets a new cache, and the old one is deleted only after the new one is complete.
// Only precached same-origin GET files are ever served from the cache. Nothing else is stored, so API calls (another
// origin, or any /api/ path) and auth responses can never end up there.
// Cached responses keep the Cross-Origin-Opener/Embedder-Policy headers they were stored with, which expo-sqlite
// (SharedArrayBuffer) needs.
'use strict';

const PREFIX = 'pb-shell-';
const HASHED = /^\/(?:assets|_expo\/static)\//;
// Live pose tracking (#947) loads its camera view and TensorFlow.js model code (chunks named pose-*) only when a user opens
// it. They are never precached (the app shell must stay small); the model weights and .wasm files under /pose/ are not hashed
// paths, so this worker never touches them either.
const ON_DEMAND = /\/pose-[^/]*\.js$/;

/** Same-origin files this worker may cache or serve from the cache: GET, not an API or auth path. */
function cacheable(url, origin) {
  const u = new URL(url, origin);
  return u.origin === origin && !/^\/(?:api|auth)\//.test(u.pathname);
}

/** Hashed asset paths mentioned in index.html or in a bundle: quoted "/assets/..." or "/_expo/static/..." strings (double, single or backtick quotes) and src/href. On-demand chunks (see ON_DEMAND) are left out. */
function assetPaths(text) {
  const found = new Set();
  const re = /["'(`](\/(?:assets|_expo\/static)\/[^"'()`\s\\]+)/g;
  let m;
  while ((m = re.exec(text))) found.add(m[1]);
  return [...found].filter((p) => !ON_DEMAND.test(p));
}

/** Cache name for an index.html: the entry bundle path carries its content hash. */
function versionOf(html) {
  const m = /\/_expo\/static\/js\/web\/entry-[\w-]+\.js/.exec(html);
  return m ? PREFIX + m[0] : null;
}

// One build at a time: the install and the first navigation both call precache, and a second one must not fight the first.
let running = null;
function precache() {
  running = (running || Promise.resolve()).catch(() => {}).then(() => build());
  return running;
}

async function build() {
  const res = await fetch('/', { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  const name = versionOf(html);
  if (!name) return;
  if (await caches.has(name)) return;
  const cache = await caches.open(name);
  try {
    // Follow every script found (entry bundle, then the SQLite worker it names): the wasm path is only inside the worker.
    const paths = new Set(assetPaths(html));
    const scripts = [...paths].filter((p) => /\.js$/.test(p));
    while (scripts.length) {
      const p = scripts.pop();
      const js = await fetch(p);
      if (!js.ok) throw new Error(p);
      await cache.put(p, js.clone());
      for (const q of assetPaths(await js.text())) {
        if (!paths.has(q) && /\.js$/.test(q)) scripts.push(q);
        paths.add(q);
      }
    }
    for (const p of paths) {
      if (!(await cache.match(p))) {
        const r = await fetch(p);
        if (!r.ok) throw new Error(p);
        await cache.put(p, r);
      }
    }
    // The index goes in last: its presence means the cache is complete.
    await cache.put('/', res);
  } catch (e) {
    await caches.delete(name); // incomplete: keep serving the previous cache
    throw e;
  }
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
}

async function shellCache() {
  for (const k of await caches.keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const c = await caches.open(k);
    if (await c.match('/')) return c;
  }
  return null;
}

async function onFetch(request, origin, wait) {
  if (request.mode === 'navigate') {
    try {
      const res = await fetch(request);
      // A new deploy: build its cache in the background; this load already uses the fresh network copy.
      wait(precache().catch(() => {}));
      return res;
    } catch {
      const c = await shellCache();
      return (c && (await c.match('/'))) || Response.error();
    }
  }
  const c = await shellCache();
  return (c && (await c.match(new URL(request.url).pathname))) || fetch(request);
}

if (typeof importScripts === 'function' && typeof self.skipWaiting === 'function') {
  self.addEventListener('install', (e) => {
    e.waitUntil(precache().then(() => self.skipWaiting()));
  });
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const { request } = e;
    if (request.method !== 'GET' || !cacheable(request.url, self.location.origin)) return;
    if (request.mode !== 'navigate' && !HASHED.test(new URL(request.url).pathname)) return;
    e.respondWith(onFetch(request, self.location.origin, (p) => e.waitUntil(p)));
  });
}

if (typeof module !== 'undefined') module.exports = { cacheable, assetPaths, versionOf, precache, onFetch, PREFIX };
