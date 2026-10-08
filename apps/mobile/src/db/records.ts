import { randomUUID } from 'expo-crypto';
import type { Consent, Profile } from '../setup/types';

/** A random UUIDv4 for records that are not natural-key (expo-crypto, MIT). */
export const newId = (): string => randomUUID();

/** The subset of expo-sqlite's database the record store needs. */
export interface StoreDb {
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}

// One profile per install, under the local key 'me'. Its record id stays null until the store is bound
// to a user (see `Profile.id`). Consents are dated records, one row per agreement, keyed by their random id.
const KEY = 'me';

export async function loadProfile(db: StoreDb): Promise<Profile | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM profiles WHERE key = ?', KEY);
  return row ? (JSON.parse(row.data) as Profile) : null;
}

export async function saveProfile(db: StoreDb, p: Profile): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO profiles (key, data) VALUES (?, ?)', KEY, JSON.stringify(p));
}

/** The most recent consent record. */
export async function loadConsent(db: StoreDb): Promise<Consent | null> {
  const row = await db.getFirstAsync<{ data: string }>(
    "SELECT data FROM consents ORDER BY json_extract(data, '$.given_at') DESC LIMIT 1",
  );
  return row ? (JSON.parse(row.data) as Consent) : null;
}

/** Adds a consent record; earlier ones are kept. */
export async function saveConsent(db: StoreDb, c: Consent): Promise<void> {
  await db.runAsync('INSERT INTO consents (key, data) VALUES (?, ?)', c.id, JSON.stringify(c));
}
