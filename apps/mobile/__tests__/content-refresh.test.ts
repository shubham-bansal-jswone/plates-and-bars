import { BUNDLED } from '../src/content/bundled';
import { bundle, loadContent } from '../src/content/loader';
import { MAX_BUNDLE_BYTES, etagHash, refreshContent, sha256Hex } from '../src/content/refresh';
import { getManifestEtag, loadStored, putStored } from '../src/content/store';
import { openDb } from './sync-helpers';

/* eslint-disable @typescript-eslint/no-require-imports */
// The test runs with apps/mobile as the working directory; node's modules are required because the app has no node typings.
const { createHash } = require('node:crypto') as { createHash(a: string): { update(d: Uint8Array): { digest(e: string): string } } };
const { readdirSync, readFileSync } = require('node:fs') as { readdirSync(p: string): string[]; readFileSync(p: string): Uint8Array };
/* eslint-enable @typescript-eslint/no-require-imports */
const CONTENT = '../../content';
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'sha256' },
    digest: async (a: string, data: Uint8Array) => {
      const b = nodeCrypto.createHash(a).update(data).digest();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    },
    randomUUID: () => globalThis.crypto.randomUUID(),
  };
});

const sha = (s: string) => createHash('sha256').update(utf8(s)).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s).buffer;
const NAME = 'measures';
const LATER = '2099-01-01T00:00:00Z';
const EARLIER = '2000-01-01T00:00:00Z';
const bundledSchema = BUNDLED[NAME]!.schema_version;
const body = (extra = 'x') => JSON.stringify({ schema_version: bundledSchema, note: extra });

interface Served { entry: Record<string, unknown>; bytes?: ArrayBuffer; status?: number }
/** A fake generated client: records every call (path and headers) and serves the given manifest and bundles. */
function fakeApi(served: Served[], opts: { manifestEtag?: string; offline?: boolean; manifestStatus?: number; hang?: boolean; hangBundle?: boolean; contentEncoding?: string; onCancel?: () => void; stream?: boolean; contentLength?: number } = {}) {
  const calls: { path: string; headers?: Record<string, string>; signal?: AbortSignal }[] = [];
  const api = {
    GET: async (path: string, o: { params?: { path: { bundle: string } }; headers?: Record<string, string>; signal?: AbortSignal }) => {
      calls.push({ path, headers: o.headers, signal: o.signal });
      if (opts.offline) throw new TypeError('Network request failed');
      if (opts.hang) return new Promise((_r, rej) => o.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      if (path === '/content/manifest') {
        const status = opts.manifestStatus ?? 200;
        const headers = new Headers({ ETag: opts.manifestEtag ?? '"m1"' });
        return status === 304 ? { response: new Response(null, { status, headers }) } : { data: { bundles: served.map((s) => s.entry) }, response: new Response('{}', { status, headers }) };
      }
      const s = served.find((x) => x.entry.name === o.params!.path.bundle);
      if (!s || !s.bytes) return { response: new Response('{}', { status: 404 }) };
      if (opts.hangBundle) return new Promise((_r, rej) => o.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      const headers = new Headers(opts.contentLength === undefined ? {} : { 'Content-Length': String(opts.contentLength) });
      if (opts.contentEncoding) headers.set('Content-Encoding', opts.contentEncoding);
      if (opts.onCancel) {
        // two chunks, the first already past the manifest size: the reader must cancel the stream instead of draining it
        const stream = new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(new Uint8Array(500)); c.enqueue(new Uint8Array(500)); }, cancel: opts.onCancel });
        return { data: stream, response: new Response(null, { status: 200, headers }) };
      }
      const response = new Response(s.bytes, { status: s.status ?? 200, headers });
      // data is the body stream where the platform has one (the client's parseAs 'stream'), else null and the body is read whole
      return { data: opts.stream ? response.body : null, response };
    },
  };
  return { api: api as never, calls };
}
const entryFor = (text: string, over: Record<string, unknown> = {}) => ({ name: NAME, schema_version: bundledSchema, sha256: sha(text), size_bytes: utf8(text).length, updated_at: LATER, ...over });

describe('content refresh', () => {
  it('stores a verified newer bundle and loads it at the next start', async () => {
    const db = await openDb();
    const text = body('new');
    const { api } = fakeApi([{ entry: entryFor(text), bytes: enc(text) }]);
    expect(await refreshContent({ db, api })).toBe(1);
    expect((await loadStored(db)).map((b) => b.name)).toEqual([NAME]);
    expect(await getManifestEtag(db)).toBe('m1');
    await loadContent(db);
    expect(bundle(NAME, { fallback: true })).toEqual({ schema_version: bundledSchema, note: 'new' });
  });

  it('rejects a body whose hash does not match the manifest', async () => {
    const db = await openDb();
    const text = body('a');
    const tampered = body('b'); // same length
    const { api } = fakeApi([{ entry: entryFor(text), bytes: enc(tampered) }]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
    expect(await getManifestEtag(db)).toBeNull(); // retried next time, not hidden by a 304
  });

  it('rejects a body whose size does not match the manifest', async () => {
    const db = await openDb();
    const text = body('a');
    const { api } = fakeApi([{ entry: entryFor(text, { size_bytes: utf8(text).length + 1 }), bytes: enc(text) }]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
  });

  it('ignores a bundle whose updated_at is not later than the bundled copy', async () => {
    const db = await openDb();
    const text = body('old');
    const { api, calls } = fakeApi([{ entry: entryFor(text, { updated_at: EARLIER }), bytes: enc(text) }]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(['/content/manifest']);
  });

  it('ignores an unsupported schema_version and an unknown bundle name', async () => {
    const db = await openDb();
    const t1 = JSON.stringify({ schema_version: bundledSchema + 1 });
    const t2 = body('z');
    const { api, calls } = fakeApi([
      { entry: entryFor(t1, { schema_version: bundledSchema + 1 }), bytes: enc(t1) },
      { entry: entryFor(t2, { name: 'not-a-bundle' }), bytes: enc(t2) },
    ]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(await loadStored(db)).toEqual([]);
  });

  it('rejects a body whose own schema_version differs from the manifest entry', async () => {
    const db = await openDb();
    const bad = JSON.stringify({ schema_version: bundledSchema + 1 });
    const { api } = fakeApi([{ entry: entryFor(bad), bytes: enc(bad) }]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
  });

  it.each([['not JSON', utf8('not json at all')], ['a JSON array', utf8('[1]')]])('rejects a body that is %s', async (_n, bytes) => {
    const db = await openDb();
    const entry = { name: NAME, schema_version: bundledSchema, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, updated_at: LATER };
    expect(await refreshContent({ db, ...fakeApi([{ entry, bytes: bytes.buffer as ArrayBuffer }]) })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
  });

  it('rejects a body that is not valid UTF-8 even when size and hash match', async () => {
    const db = await openDb();
    const head = utf8(`{"schema_version":${bundledSchema},"a":"`);
    const bytes = new Uint8Array([...head, 0xff, 0xfe, ...utf8('"}')]); // 0xff is never valid UTF-8; a lenient decode would store U+FFFD
    const entry = { name: NAME, schema_version: bundledSchema, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, updated_at: LATER };
    expect(await refreshContent({ db, ...fakeApi([{ entry, bytes: bytes.buffer as ArrayBuffer }]) })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
  });

  it('sends If-None-Match with the stored manifest hash and stops on 304', async () => {
    const db = await openDb();
    const text = body('a');
    await refreshContent({ db, ...fakeApi([{ entry: entryFor(text), bytes: enc(text) }], { manifestEtag: 'W/"abc123"' }) });
    expect(await getManifestEtag(db)).toBe('abc123'); // W/ prefix tolerated
    const second = fakeApi([], { manifestStatus: 304 });
    expect(await refreshContent({ db, api: second.api })).toBe(0);
    expect(second.calls.map(({ path, headers }) => ({ path, headers }))).toEqual([{ path: '/content/manifest', headers: { 'If-None-Match': '"abc123"' } }]);
  });

  it('sends no Authorization header and no user data', async () => {
    const db = await openDb();
    const { api, calls } = fakeApi([]);
    await refreshContent({ db, api });
    expect(JSON.stringify(calls)).not.toMatch(/authorization/i);
  });

  it('offline failure leaves the stored and bundled copies and does not throw', async () => {
    const db = await openDb();
    const old = body('kept');
    await putStored(db, { name: NAME, sha256: sha(old), schema_version: bundledSchema, updated_at: LATER, body: old });
    expect(await refreshContent({ db, ...fakeApi([], { offline: true }) })).toBe(0);
    expect((await loadStored(db))[0]?.body).toBe(old);
    expect(await getManifestEtag(db)).toBeNull();
  });

  it('stores a server revert to the shipped bytes, and a later rollback to older content does not resurrect the old copy', async () => {
    const db = await openDb();
    const shippedAt = BUNDLED[NAME]!.updated_at;
    const x = body('X');
    await putStored(db, { name: NAME, sha256: sha(x), schema_version: bundledSchema, updated_at: '2090-01-01T00:00:00Z', body: x });
    // the shipped copy B is re-served with a later date (a revert commit): stored like any later bundle
    const b = text(readFileSync(`${CONTENT}/${NAME}.json`));
    const revert = { name: NAME, schema_version: bundledSchema, sha256: BUNDLED[NAME]!.sha256, size_bytes: utf8(b).length, updated_at: '2091-01-01T00:00:00Z' };
    expect(await refreshContent({ db, ...fakeApi([{ entry: revert, bytes: utf8(b).buffer as ArrayBuffer }]) })).toBe(1);
    expect((await loadStored(db))[0]).toMatchObject({ sha256: BUNDLED[NAME]!.sha256, updated_at: '2091-01-01T00:00:00Z' });
    await loadContent(db);
    expect(bundle(NAME, 'bundled')).not.toBe('bundled'); // kept at launch: later than the bundled date
    // the server image is rolled back to X's older date: ignored
    const rolled = fakeApi([{ entry: entryFor(x, { updated_at: '2090-01-01T00:00:00Z' }), bytes: enc(x) }]);
    expect(await refreshContent({ db, api: rolled.api })).toBe(0);
    expect((await loadStored(db))[0]?.updated_at).toBe('2091-01-01T00:00:00Z');
    expect(shippedAt < '2091-01-01T00:00:00Z').toBe(true);
  });

  it('does not save the manifest hash when a write fails', async () => {
    const db = await openDb();
    const t = body('new');
    const failing = { ...db, runAsync: async (sql: string, ...p: (string | number)[]) => { if (sql.startsWith('INSERT OR REPLACE INTO content_bundles')) throw new Error('disk full'); return db.runAsync(sql, ...p); } };
    expect(await refreshContent({ db: failing, ...fakeApi([{ entry: entryFor(t), bytes: enc(t) }]) })).toBe(0);
    expect(await getManifestEtag(db)).toBeNull();
    expect(await refreshContent({ db, ...fakeApi([{ entry: entryFor(t), bytes: enc(t) }]) })).toBe(1); // retried next pass
    expect(await getManifestEtag(db)).toBe('m1');
  });

  it('saves the manifest hash only after every bundle write', async () => {
    const db = await openDb();
    const order: string[] = [];
    const spy = { ...db, runAsync: async (sql: string, ...p: (string | number)[]) => { order.push(sql.includes('content_bundles') ? 'bundle' : sql.includes('settings') ? 'etag' : 'other'); return db.runAsync(sql, ...p); } };
    const t = body('a');
    await refreshContent({ db: spy, ...fakeApi([{ entry: entryFor(t), bytes: enc(t) }]) });
    expect(order).toEqual(['bundle', 'etag']);
  });

  it('refuses a bundle over the size cap without fetching it', async () => {
    const db = await openDb();
    const t = body('a');
    const { api, calls } = fakeApi([{ entry: entryFor(t, { size_bytes: MAX_BUNDLE_BYTES + 1 }), bytes: enc(t) }]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(calls.map((c) => c.path)).toEqual(['/content/manifest']);
    expect(await getManifestEtag(db)).toBeNull();
  });

  it('refuses a body whose Content-Length is larger than the manifest says', async () => {
    const db = await openDb();
    const t = body('a');
    const { api } = fakeApi([{ entry: entryFor(t), bytes: enc(t) }], { contentLength: MAX_BUNDLE_BYTES * 2 });
    expect(await refreshContent({ db, api })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
  });

  it('stops reading a streamed body that runs past the manifest size, and stores a correct streamed one', async () => {
    const db = await openDb();
    const t = body('streamed');
    const long = utf8(t + ' '.repeat(50));
    const over = fakeApi([{ entry: entryFor(t), bytes: long.buffer as ArrayBuffer }], { stream: true });
    expect(await refreshContent({ db, api: over.api })).toBe(0);
    expect(await loadStored(db)).toEqual([]);
    expect(await refreshContent({ db, ...fakeApi([{ entry: entryFor(t), bytes: enc(t) }], { stream: true, manifestEtag: '"m2"' }) })).toBe(1);
  });

  it('cancels the stream as soon as the body passes the manifest size', async () => {
    const db = await openDb();
    const t = body('a');
    const onCancel = jest.fn();
    expect(await refreshContent({ db, ...fakeApi([{ entry: entryFor(t), bytes: enc(t) }], { onCancel }) })).toBe(0);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('times out a bundle request that hangs', async () => {
    const db = await openDb();
    const t = body('a');
    const hung = fakeApi([{ entry: entryFor(t), bytes: enc(t) }], { hangBundle: true });
    expect(await refreshContent({ db, api: hung.api, timeoutMs: 30 })).toBe(0);
    const bundleCall = hung.calls.find((c) => c.path !== '/content/manifest');
    expect(bundleCall?.signal?.aborted).toBe(true);
    expect(await getManifestEtag(db)).toBeNull();
  });

  it('does not reject on Content-Length when the body is compressed (the length is of the encoded body)', async () => {
    const db = await openDb();
    const t = body('enc');
    const { api } = fakeApi([{ entry: entryFor(t), bytes: enc(t) }], { contentLength: MAX_BUNDLE_BYTES * 2, contentEncoding: 'gzip' });
    expect(await refreshContent({ db, api })).toBe(1);
  });

  it('gives every request an abort signal and gives up on a request that hangs', async () => {
    const db = await openDb();
    const ok = fakeApi([]);
    await refreshContent({ db, api: ok.api });
    expect(ok.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    const hung = fakeApi([], { hang: true });
    expect(await refreshContent({ db, api: hung.api, timeoutMs: 20 })).toBe(0);
    expect(hung.calls[0]?.signal?.aborted).toBe(true);
  });

  it('joins a refresh that is already running instead of starting a second', async () => {
    const db = await openDb();
    const t = body('a');
    const { api, calls } = fakeApi([{ entry: entryFor(t), bytes: enc(t) }]);
    const [a, b] = await Promise.all([refreshContent({ db, api }), refreshContent({ db, api })]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c.path === '/content/manifest')).toHaveLength(1);
    expect(await refreshContent({ db, api: fakeApi([], { manifestStatus: 304 }).api })).toBe(0); // free again afterwards
  });

  it('keeps the old copy when the swap fails midway', async () => {
    const db = await openDb();
    const old = body('old');
    await putStored(db, { name: NAME, sha256: sha(old), schema_version: bundledSchema, updated_at: '2090-01-01T00:00:00Z', body: old });
    const text = body('new');
    const failing = { ...db, runAsync: async (sql: string, ...p: (string | number)[]) => { if (sql.startsWith('INSERT OR REPLACE INTO content_bundles')) throw new Error('disk full'); return db.runAsync(sql, ...p); } };
    expect(await refreshContent({ db: failing, ...fakeApi([{ entry: entryFor(text), bytes: enc(text) }]) })).toBe(0);
    expect((await loadStored(db))[0]?.body).toBe(old);
    expect(await getManifestEtag(db)).toBeNull();
  });

  it('only takes a copy later than the stored one, not just than the bundled one', async () => {
    const db = await openDb();
    const stored = body('stored');
    await putStored(db, { name: NAME, sha256: sha(stored), schema_version: bundledSchema, updated_at: '2095-01-01T00:00:00Z', body: stored });
    const text = body('mid'); // later than bundled, earlier than stored
    const { api, calls } = fakeApi([{ entry: entryFor(text, { updated_at: '2090-01-01T00:00:00Z' }), bytes: enc(text) }]);
    expect(await refreshContent({ db, api })).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('content at app start', () => {
  const put = (db: Awaited<ReturnType<typeof openDb>>, over: Partial<{ name: string; updated_at: string; schema_version: number; sha256: string }>) => {
    const text = body('s');
    return putStored(db, { name: NAME, sha256: sha(text), schema_version: bundledSchema, updated_at: LATER, body: text, ...over });
  };

  it('keeps a later, supported stored copy', async () => {
    const db = await openDb();
    await put(db, {});
    await loadContent(db);
    expect(bundle(NAME, 'bundled')).not.toBe('bundled');
  });

  it.each([
    ['older updated_at (app upgrade caught up)', { updated_at: EARLIER }],
    ['unsupported schema_version', { schema_version: bundledSchema + 1 }],
    ['unknown name', { name: 'not-a-bundle' }],
  ])('discards a stored copy with %s and uses the bundled one', async (_n, over) => {
    const db = await openDb();
    await put(db, over);
    await loadContent(db);
    expect(bundle(NAME, 'bundled')).toBe('bundled');
    expect(await loadStored(db)).toEqual([]);
  });

  it('keeps a later stored copy even when its bytes equal the shipped ones (a server revert)', async () => {
    const db = await openDb();
    await put(db, { sha256: BUNDLED[NAME]!.sha256 });
    await loadContent(db);
    expect(bundle(NAME, 'bundled')).not.toBe('bundled');
  });

  it('uses the bundled copy when the store cannot be read', async () => {
    const db = await openDb();
    await loadContent({ ...db, getAllAsync: async () => { throw new Error('locked'); } });
    expect(bundle(NAME, 'bundled')).toBe('bundled');
  });
});

describe('hashing and bundled record', () => {
  it('matches the shared content-hash vectors', async () => {
    const vectors = JSON.parse(text(readFileSync('../../packages/api/test-vectors/content-hash.json'))).cases;
    for (const c of vectors) expect(await sha256Hex(new TextEncoder().encode(c.text))).toBe(c.sha256);
  });

  it('reads ETags with or without W/ and quotes', () => {
    expect(etagHash('"abc"')).toBe('abc');
    expect(etagHash('W/"abc"')).toBe('abc');
    expect(etagHash(null)).toBeNull();
  });

  it('records every content file', () => {
    const files = readdirSync(CONTENT).filter((f: string) => f.endsWith('.json')).map((f: string) => f.slice(0, -5));
    expect(Object.keys(BUNDLED).sort()).toEqual(files.sort());
  });

  it('src/content/bundled.json matches the content files (bytes and schema_version)', () => {
    for (const [name, m] of Object.entries(BUNDLED)) {
      const bytes = readFileSync(`${CONTENT}/${name}.json`);
      expect({ name, sha: createHash('sha256').update(bytes).digest('hex') }).toEqual({ name, sha: m.sha256 });
      expect(JSON.parse(text(bytes)).schema_version).toBe(m.schema_version);
      expect(m.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });
});
