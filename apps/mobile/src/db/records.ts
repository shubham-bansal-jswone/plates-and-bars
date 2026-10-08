import type { Consent, Profile } from '../setup/types';

/** The subset of expo-sqlite's database the record store needs. */
export interface StoreDb {
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}

// One profile and one consent per install. The key is local; ids are random until sync exists,
// then the sync client re-keys natural-key tables to UUIDv5 (contract: `POST /sync`, Record ids).
const KEY = 'me';

export function newId(): string {
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function read<T>(db: StoreDb, table: 'profiles' | 'consents'): Promise<T | null> {
  const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${table} WHERE key = ?`, KEY);
  return row ? (JSON.parse(row.data) as T) : null;
}

async function write(db: StoreDb, table: 'profiles' | 'consents', doc: object): Promise<void> {
  await db.runAsync(`INSERT OR REPLACE INTO ${table} (key, data) VALUES (?, ?)`, KEY, JSON.stringify(doc));
}

export const loadProfile = (db: StoreDb) => read<Profile>(db, 'profiles');
export const loadConsent = (db: StoreDb) => read<Consent>(db, 'consents');
export const saveProfile = (db: StoreDb, p: Profile) => write(db, 'profiles', p);
export const saveConsent = (db: StoreDb, c: Consent) => write(db, 'consents', c);
