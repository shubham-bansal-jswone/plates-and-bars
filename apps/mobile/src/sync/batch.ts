// Size-aware request building for POST /sync. The server refuses a body over 2 MB (2,097,152 bytes) with a 400 whose
// `field` is empty, so it names no record: the client keeps every request under the limit itself (contract 0.1.9).

/** The server's request limit: bodies over this are refused with `too_large`. */
export const MAX_BODY_BYTES = 2_097_152;
/** What a normal request is built to stay under: headroom for the estimate being a little off. */
export const BODY_BUDGET_BYTES = 1_572_864;

/** Bytes of `s` as UTF-8 (what goes over the wire), without allocating a buffer. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4; // a surrogate pair is one 4-byte character
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Counts the bytes of a `{ cursor, changes }` body as records are added, without serialising the whole body each time.
 * The count is never below the real size (a comma is counted per record and per table).
 */
export class BodySize {
  private bytes: number;
  private tables = new Set<string>();
  constructor(cursor: string | null) {
    this.bytes = utf8Length(JSON.stringify({ cursor, changes: {} }));
  }
  /** Bytes the body would have after adding a record of `recordBytes` to `tbl`. */
  with(tbl: string, recordBytes: number): number {
    return this.bytes + recordBytes + 1 + (this.tables.has(tbl) ? 0 : utf8Length(JSON.stringify(tbl)) + 4);
  }
  add(tbl: string, recordBytes: number): void {
    this.bytes = this.with(tbl, recordBytes);
    this.tables.add(tbl);
  }
  get total(): number {
    return this.bytes;
  }
}
