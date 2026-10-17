import type { StoreDb } from '../db/records';
import type { Settings } from '../settings/types';
import { KEY_SETTINGS_KEPT } from '../sync/store';

type Fields = Record<string, unknown>;

/**
 * A settings edit whose save failed (#627, #651). `base` and `value` hold, for each field the edit changed, the stored value
 * the edit started from and the value it produced; they are what survives an app restart (`f` does not). An edit not yet
 * written down (no `base`) is still its function.
 */
export interface KeptEdit {
  f?: (s: Settings) => Settings;
  at: string;
  base?: Fields;
  value?: Fields;
}

/**
 * Structural equality that ignores the order of object keys (arrays stay ordered). The server stores records in a JSON column that
 * reorders keys, so a pulled object field can hold the same content in another order and must not count as changed.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  const x = a as Fields;
  const y = b as Fields;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => Object.prototype.hasOwnProperty.call(y, k) && same(x[k], y[k]));
}

/**
 * Applies kept edits on top of the stored record, each once. A field the stored record no longer has as the edit found it was
 * changed since by a pull (nothing else writes it between a failed save and the next one): the newer value wins, and the edit
 * is dropped for that field only (#651). Edits for other fields still apply. Edits still being functions are turned into
 * `base`/`value` here, against the stored record, so they can be persisted.
 * The unit is the top-level field of the record: an edit to one key of an object field (`adjustments`, `learn`,
 * `exercise_overrides`) is kept as the whole object, so a pull that changed a sibling key of it drops the edit. That is lossy
 * but safe: the pulled value is never overwritten.
 */
export function replayKept(stored: Settings, kept: KeptEdit[]): Settings {
  let run = stored;
  for (const k of kept) {
    if (!k.base || !k.value) {
      const after = (k.f as (s: Settings) => Settings)(run);
      const base: Fields = {};
      const value: Fields = {};
      for (const key of Object.keys(after) as (keyof Settings)[]) {
        if (key === 'updated_at' || same(run[key], after[key])) continue;
        base[key] = stored[key];
        value[key] = after[key];
      }
      k.base = base;
      k.value = value;
      run = after;
      continue;
    }
    const out: Fields = { ...run, updated_at: k.at };
    for (const key of Object.keys(k.value)) {
      if (same((stored as unknown as Fields)[key], k.base[key])) out[key] = k.value[key];
      else {
        delete k.value[key];
        delete k.base[key];
      }
    }
    run = out as unknown as Settings;
  }
  return run;
}

/** The version of the saved format. A copy of another (or no) version reads as none, rather than being guessed at. */
const KEPT_VERSION = 1;

/** The kept edits that are plain data, in the saved format. */
export const keptCopy = (kept: KeptEdit[]): string => JSON.stringify({ v: KEPT_VERSION, edits: kept.filter((k) => k.base && k.value).map(({ at, base, value }) => ({ at, base, value })) });

/** Writes the kept edits that are plain data, so a restart does not lose them. */
export async function persistKept(db: StoreDb, kept: KeptEdit[]): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', KEY_SETTINGS_KEPT, keptCopy(kept));
}

export async function clearKept(db: StoreDb): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_SETTINGS_KEPT);
}

const isPlain = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The persisted kept edits; anything unreadable, of another version or in the wrong shape counts as none. */
export async function readKept(db: StoreDb): Promise<KeptEdit[]> {
  try {
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY_SETTINGS_KEPT);
    const saved = row ? (JSON.parse(row.value) as unknown) : null;
    if (!isPlain(saved) || saved.v !== KEPT_VERSION || !Array.isArray(saved.edits)) return [];
    return saved.edits.filter((k): k is KeptEdit => isPlain(k) && typeof k.at === 'string' && isPlain(k.base) && isPlain(k.value));
  } catch {
    return [];
  }
}
