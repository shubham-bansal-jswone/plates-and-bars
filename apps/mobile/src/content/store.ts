import type { BundleMeta } from './bundled';

/** The subset of the app database the content store needs. */
export interface ContentDb {
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}

export interface StoredBundle extends BundleMeta {
  name: string;
  body: string;
}

const KEY_ETAG = 'content.manifest_etag';

export const loadStored = (db: ContentDb): Promise<StoredBundle[]> =>
  db.getAllAsync<StoredBundle>('SELECT name, sha256, schema_version, updated_at, body FROM content_bundles');

/** Replaces the stored copy of one bundle in a single statement: it is either the old row or the new one, never a mix. */
export const putStored = (db: ContentDb, b: StoredBundle): Promise<unknown> =>
  db.runAsync('INSERT OR REPLACE INTO content_bundles (name, sha256, schema_version, updated_at, body) VALUES (?, ?, ?, ?, ?)', b.name, b.sha256, b.schema_version, b.updated_at, b.body);

export const deleteStored = (db: ContentDb, name: string): Promise<unknown> => db.runAsync('DELETE FROM content_bundles WHERE name = ?', name);

/** Hash of the manifest last fully applied (device-local `content.` key; sync and sign-out only touch `sync.` keys). */
export async function getManifestEtag(db: ContentDb): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY_ETAG))?.value ?? null;
}
export const setManifestEtag = (db: ContentDb, hash: string): Promise<unknown> =>
  db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY_ETAG, hash);
