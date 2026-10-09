import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { BUNDLED } from './bundled';
import { beatsBundled } from './loader';
import { deleteStored, getManifestEtag, loadStored, putStored, setManifestEtag, type ContentDb } from './store';

type Entry = Schemas['ContentBundleInfo'];

/** Lowercase hex SHA-256 of the exact bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The bare hash of an ETag value: drops a `W/` prefix and the quotes. */
export const etagHash = (etag: string | null | undefined): string | null => (etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') || null : null);

export interface RefreshDeps {
  db: ContentDb;
  /** A client with no token: these endpoints are public and nothing user-specific is sent. */
  api: ApiClient;
  sha256?: (bytes: Uint8Array) => Promise<string>;
}

/** Downloads one bundle and stores it only if its size and SHA-256 match the manifest entry and it parses with that schema_version. */
async function fetchOne(d: RefreshDeps, e: Entry): Promise<boolean> {
  const { data, response } = await d.api.GET('/content/{bundle}', { params: { path: { bundle: e.name } }, parseAs: 'arrayBuffer' });
  if (!response.ok || !data) return false;
  const bytes = new Uint8Array(data as ArrayBuffer);
  if (bytes.byteLength !== e.size_bytes) return false;
  if ((await (d.sha256 ?? sha256Hex)(bytes)) !== e.sha256) return false;
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(body) as { schema_version?: unknown } | null;
    if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== e.schema_version) return false;
  } catch {
    return false;
  }
  await putStored(d.db, { name: e.name, sha256: e.sha256, schema_version: e.schema_version, updated_at: e.updated_at, body });
  return true;
}

/**
 * One refresh pass (app launch, then at most daily): manifest with If-None-Match, then each bundle that is known,
 * supported, different and later. Never throws and shows nothing: any failure keeps the copy already held and the next
 * pass tries again. Returns how many bundles were stored (they apply on the next launch).
 */
export async function refreshContent(d: RefreshDeps): Promise<number> {
  let stored = 0;
  try {
    const known = await getManifestEtag(d.db);
    const { data, response } = await d.api.GET('/content/manifest', { headers: known ? { 'If-None-Match': `"${known}"` } : {} });
    if (response.status === 304 || !data) return 0;
    const held = new Map((await loadStored(d.db)).map((b) => [b.name, b]));
    let failed = false;
    for (const e of data.bundles) {
      const bundled = BUNDLED[e.name];
      if (!bundled) continue; // unknown name
      const have = held.get(e.name) ?? bundled;
      // The server went back to the bytes this build ships, later than the copy we hold: drop that copy (applies next launch).
      if (held.has(e.name) && e.sha256 === bundled.sha256 && e.schema_version === bundled.schema_version && Date.parse(e.updated_at) > Date.parse(have.updated_at)) {
        await deleteStored(d.db, e.name);
        continue;
      }
      // the stored-copy test of loadContent, plus the later-than-what-we-hold rule
      if (!beatsBundled(e.name, e) || e.sha256 === have.sha256 || Date.parse(e.updated_at) <= Date.parse(have.updated_at)) continue;
      try {
        if (await fetchOne(d, e)) stored++;
        else failed = true;
      } catch {
        failed = true;
      }
    }
    // Remember the manifest only when every wanted bundle landed, so a 304 never hides a retry.
    const tag = etagHash(response.headers.get('ETag'));
    if (!failed && tag) await setManifestEtag(d.db, tag);
  } catch {
    // offline or server trouble: keep what we have
  }
  return stored;
}
