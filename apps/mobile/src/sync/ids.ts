import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import type { SyncTableName } from '../db/outbox';

const hex = (n: number) => n.toString(16).padStart(2, '0');

/**
 * UUIDv5 (RFC 9562) of `name` in the namespace UUID, lowercase canonical form. SHA-1 comes from expo-crypto; on web that is
 * `crypto.subtle`, which needs a secure context (https or localhost).
 */
export async function uuidv5(namespace: string, name: string): Promise<string> {
  const ns = namespace.replace(/-/g, '').match(/../g)!.map((x) => parseInt(x, 16));
  const bytes = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const d = new Uint8Array((await digest(CryptoDigestAlgorithm.SHA1, bytes)).slice(0, 16));
  d[6] = ((d[6] as number) & 0x0f) | 0x50;
  d[8] = ((d[8] as number) & 0x3f) | 0x80;
  const x = [...d].map(hex).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Contract id of a natural-key record: UUIDv5(user id, `<table>:<key>`); the key is used exactly as stored. */
export const naturalId = (userId: string, table: SyncTableName, key: string): Promise<string> => uuidv5(userId, `${table}:${key}`);

/** Tables whose local `key` is the natural key (the others are keyed by their random id). */
export const NATURAL_KEY_TABLES: ReadonlySet<SyncTableName> = new Set<SyncTableName>([
  'profiles', 'settings', 'day_notes', 'workouts', 'weights', 'measurements', 'lift_stats', 'swaps',
]);
