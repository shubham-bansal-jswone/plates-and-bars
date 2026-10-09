import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { BUNDLED } from './bundled';
import { beatsBundled } from './loader';
import { getManifestEtag, loadStored, putStored, setManifestEtag, type ContentDb, type StoredBundle } from './store';

type Entry = Schemas['ContentBundleInfo'];

/** No bundle is anywhere near this (the largest is under 100 kB); anything bigger is refused before it is read. */
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 20_000;

/** Lowercase hex SHA-256 of the exact bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The bare hash of an ETag value: drops a `W/` prefix and the quotes. */
export const etagHash = (etag: string | null | undefined): string | null => (etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') || null : null);

export interface RefreshDeps {
  /** The app database behind the write lock (`useDb()`), so writes wait for a running sync transaction. */
  db: ContentDb;
  /** A client with no token: these endpoints are public and nothing user-specific is sent. */
  api: ApiClient;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  timeoutMs?: number;
}

const timeoutSignal = (ms: number): AbortSignal => {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

/** Reads a body of at most `limit` bytes; null when it is longer (the read stops there). Streams where the platform can, else reads whole after the length checks. */
async function readLimited(data: ReadableStream<Uint8Array> | null | undefined, response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > limit) return null;
  if (!data || typeof data.getReader !== 'function') {
    const all = new Uint8Array(await response.arrayBuffer());
    return all.byteLength > limit ? null : all;
  }
  const reader = data.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** Downloads one bundle and returns it only if its size and SHA-256 match the manifest entry, it is UTF-8 and parses with that schema_version. */
async function fetchOne(d: RefreshDeps, e: Entry): Promise<StoredBundle | null> {
  if (e.size_bytes > MAX_BUNDLE_BYTES) return null;
  const { data, response } = await d.api.GET('/content/{bundle}', { params: { path: { bundle: e.name } }, parseAs: 'stream', signal: timeoutSignal(d.timeoutMs ?? REQUEST_TIMEOUT_MS) });
  if (!response.ok) return null;
  const bytes = await readLimited(data as ReadableStream<Uint8Array> | null, response, e.size_bytes);
  if (!bytes || bytes.byteLength !== e.size_bytes) return null;
  if ((await (d.sha256 ?? sha256Hex)(bytes)) !== e.sha256) return null;
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(body) as { schema_version?: unknown } | null;
    if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== e.schema_version) return null;
    return { name: e.name, sha256: e.sha256, schema_version: e.schema_version, updated_at: e.updated_at, body };
  } catch {
    return null;
  }
}

let running: Promise<number> | null = null;

/**
 * One refresh pass (app launch, then at most daily): manifest with If-None-Match, then each bundle that is known,
 * supported, different from the copy held and later than it. A bundle the server reverts to the shipped bytes is stored
 * like any other later one. Never throws and shows nothing: any failure keeps the copy already held and the next pass
 * tries again. A pass already running is joined, not started twice. Returns how many bundles were stored (they apply on
 * the next launch).
 */
export function refreshContent(d: RefreshDeps): Promise<number> {
  running ??= pass(d).finally(() => { running = null; });
  return running;
}

async function pass(d: RefreshDeps): Promise<number> {
  try {
    const known = await getManifestEtag(d.db);
    const { data, response } = await d.api.GET('/content/manifest', {
      headers: known ? { 'If-None-Match': `"${known}"` } : {},
      signal: timeoutSignal(d.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    if (response.status === 304 || !data) return 0;
    const held = new Map((await loadStored(d.db)).map((b) => [b.name, b]));
    const fetched: StoredBundle[] = [];
    let failed = false;
    for (const e of data.bundles) {
      const bundled = BUNDLED[e.name];
      if (!bundled) continue; // unknown name
      const have = held.get(e.name) ?? bundled;
      if (!beatsBundled(e.name, e) || e.sha256 === have.sha256 || Date.parse(e.updated_at) <= Date.parse(have.updated_at)) continue;
      try {
        const b = await fetchOne(d, e);
        if (b) fetched.push(b);
        else failed = true;
      } catch {
        failed = true;
      }
    }
    // Writes after all downloads, in order through the write lock; the manifest is remembered only once every write
    // committed and nothing failed, so a 304 never hides a retry.
    let stored = 0;
    for (const b of fetched) {
      try {
        await putStored(d.db, b);
        stored++;
      } catch {
        failed = true;
      }
    }
    const tag = etagHash(response.headers.get('ETag'));
    if (!failed && tag) await setManifestEtag(d.db, tag);
    return stored;
  } catch {
    return 0; // offline or server trouble: keep what we have
  }
}
