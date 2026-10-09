import type { SyncTableName } from '../db/outbox';

function sha1(bytes: number[]): number[] {
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  const bits = bytes.length * 8;
  for (let i = 7; i >= 0; i--) padded.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
  for (let off = 0; off < padded.length; off += 64) {
    const w: number[] = [];
    for (let i = 0; i < 16; i++) w[i] = (((padded[off + i * 4] as number) << 24) | ((padded[off + i * 4 + 1] as number) << 16) | ((padded[off + i * 4 + 2] as number) << 8) | (padded[off + i * 4 + 3] as number)) >>> 0;
    for (let i = 16; i < 80; i++) w[i] = rotl((w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number), 1);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + (f as number) + e + (k as number) + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
  }
  return h.flatMap((x) => [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff]);
}

function utf8(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

/** UUIDv5 (RFC 9562) of `name` in the namespace UUID, lowercase canonical form. */
export function uuidv5(namespace: string, name: string): string {
  const ns = namespace.replace(/-/g, '').match(/../g)!.map((x) => parseInt(x, 16));
  const d = sha1([...ns, ...utf8(name)]).slice(0, 16);
  d[6] = ((d[6] as number) & 0x0f) | 0x50;
  d[8] = ((d[8] as number) & 0x3f) | 0x80;
  const x = d.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Contract id of a natural-key record: UUIDv5(user id, `<table>:<key>`); the key is used exactly as stored. */
export const naturalId = (userId: string, table: SyncTableName, key: string): string => uuidv5(userId, `${table}:${key}`);

/** Tables whose local `key` is the natural key (the others are keyed by their random id). */
export const NATURAL_KEY_TABLES: ReadonlySet<SyncTableName> = new Set<SyncTableName>([
  'profiles', 'settings', 'day_notes', 'workouts', 'weights', 'measurements', 'lift_stats', 'swaps',
]);
