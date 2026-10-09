import { liftStatToRecord, liftStatTombstone, recordToLiftStat, type LiftRecord } from '@plate-and-bar/core';
import type { Schemas } from '@plate-and-bar/api';
import { SYNC_TABLES, clearPushed, inTransaction, type OutboxEntry, type PullDb, type SyncTableName } from '../db/outbox';
import type { StoreDb } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { NATURAL_KEY_TABLES, naturalId } from './ids';
import { getLiftVersion, setLiftVersion } from './store';

export type Doc = Record<string, unknown>;
type Entry = Pick<OutboxEntry, 'tbl' | 'key' | 'seq' | 'queued_at'>;

const NATURAL_FIELD: Partial<Record<SyncTableName, string>> = {
  profiles: 'me', settings: 'me', day_notes: 'date', workouts: 'date', weights: 'date', measurements: 'date', lift_stats: 'exercise', swaps: 'from',
};

/** Local row key of a contract record. */
export function localKey(tbl: SyncTableName, rec: Doc): string {
  const f = NATURAL_FIELD[tbl];
  if (f === 'me') return 'me';
  return String(f ? rec[f] : rec.id);
}

/** The contract record for an outbox entry, with ids filled in for the user; null when the row is gone. */
export async function buildRecord(db: WorkoutDb, userId: string, e: Entry): Promise<Doc | null> {
  const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${SYNC_TABLES[e.tbl]} WHERE key = ?`, e.key);
  if (!row) return null;
  const doc = JSON.parse(row.data) as Doc;
  if (e.tbl === 'lift_stats') {
    const meta = { id: await naturalId(userId, 'lift_stats', e.key), version: await getLiftVersion(db, e.key), updated_at: e.queued_at };
    if (typeof doc.deleted_at === 'string') {
      return { ...meta, ...liftStatTombstone(e.key, doc.deleted_at) };
    }
    return { ...meta, deleted_at: null, ...recordToLiftStat(e.key, doc as unknown as LiftRecord) };
  }
  if (NATURAL_KEY_TABLES.has(e.tbl)) doc.id = await naturalId(userId, e.tbl, e.key);
  if (e.tbl === 'workout_sets') {
    const w = await db.getFirstAsync<{ workout_date: string }>('SELECT workout_date FROM workout_sets WHERE key = ?', e.key);
    if (w?.workout_date) doc.workout_id = await naturalId(userId, 'workouts', w.workout_date);
  }
  return doc;
}

/** Writes a contract record into its local table (no outbox handling; callers run it in `applyPulled` or similar). `setDate` is the workout date for a workout set. */
export async function storeRecord(db: StoreDb, tbl: SyncTableName, serverRec: Doc, setDate: string | null): Promise<void> {
  const rec = normalizeTimestamps(serverRec) as Doc;
  const local = SYNC_TABLES[tbl];
  const key = localKey(tbl, rec);
  if (tbl === 'lift_stats') {
    const stat = rec as unknown as Schemas['LiftStat'];
    const data = stat.deleted_at ? { deleted_at: stat.deleted_at } : liftStatToRecord(stat);
    await db.runAsync('INSERT OR REPLACE INTO lift_stats (key, data) VALUES (?, ?)', key, JSON.stringify(data));
    await setLiftVersion(db, key, stat.version);
    return;
  }
  const data = JSON.stringify(rec);
  if (tbl === 'workout_sets') {
    const s = rec as unknown as Schemas['WorkoutSet'];
    await db.runAsync(
      'INSERT OR REPLACE INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES (?, ?, ?, ?, ?, ?)',
      key, setDate ?? '', s.kind, s.done ? 1 : 0, s.deleted_at ? 1 : 0, data,
    );
  } else if (tbl === 'food_logs' || tbl === 'water_logs') {
    await db.runAsync(`INSERT OR REPLACE INTO ${local} (key, log_date, data) VALUES (?, ?, ?)`, key, String(rec.date), data);
  } else {
    await db.runAsync(`INSERT OR REPLACE INTO ${local} (key, data) VALUES (?, ?)`, key, data);
  }
}

/** Per-pull context: the user, and a lazily built map of contract workout id to local date. */
export interface PullCtx {
  userId: string;
  dates: Map<string, string> | null;
}

/** The local date of the workout a pulled set belongs to; null when that workout is not stored yet. */
export async function setWorkoutDate(db: WorkoutDb, ctx: PullCtx, rec: Doc): Promise<string | null> {
  return (await workoutDates(db, ctx)).get(String(rec.workout_id)) ?? null;
}

async function workoutDates(db: WorkoutDb, ctx: PullCtx): Promise<Map<string, string>> {
  if (!ctx.dates) {
    const rows = await db.getAllAsync<{ key: string }>('SELECT key FROM workouts');
    ctx.dates = new Map(await Promise.all(rows.map(async (r): Promise<[string, string]> => [await naturalId(ctx.userId, 'workouts', r.key), r.key])));
  }
  return ctx.dates;
}

/** Patches sync fields of the stored copy (no outbox handling). */
export async function patchMeta(db: StoreDb, tbl: SyncTableName, key: string, meta: { version: number; updated_at?: string }): Promise<void> {
  if (tbl === 'lift_stats') return setLiftVersion(db, key, meta.version);
  const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${SYNC_TABLES[tbl]} WHERE key = ?`, key);
  if (!row) return;
  const doc = { ...(JSON.parse(row.data) as Doc), version: meta.version, ...(meta.updated_at ? { updated_at: normalizeTimestamps(meta.updated_at, 'updated_at') as string } : {}) };
  await db.runAsync(`UPDATE ${SYNC_TABLES[tbl]} SET data = ? WHERE key = ?`, JSON.stringify(doc), key);
}

/** Fixes `workout_date` of sets pulled before their workout (run after a pull; unqueued like any pulled write). */
export async function resolveOrphanSets(db: WorkoutDb & PullDb, ctx: PullCtx): Promise<void> {
  const orphans = await db.getAllAsync<{ key: string; data: string }>("SELECT key, data FROM workout_sets WHERE workout_date = ''");
  for (const o of orphans) {
    const date = (await workoutDates(db, ctx)).get((JSON.parse(o.data) as { workout_id: string }).workout_id);
    if (!date) continue;
    await inTransaction(db, async (txn) => {
      const queued = async () => (await txn.getFirstAsync<{ seq: number }>("SELECT seq FROM sync_outbox WHERE tbl = 'workout_sets' AND key = ?", o.key))?.seq ?? null;
      const before = await queued();
      await txn.runAsync('UPDATE workout_sets SET workout_date = ? WHERE key = ?', date, o.key);
      // Clear only the entry this update made; a queued edit that was already there keeps its place.
      const after = await queued();
      if (before === null && after !== null) await clearPushed(txn, { tbl: 'workout_sets', key: o.key, seq: after });
    });
  }
}

const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
/** The record fields the contract types as `Timestamp` (date-time with `Z`). Other strings are user content and stay as sent. */
const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set(['updated_at', 'deleted_at', 'given_at', 'logged_at', 't']);

/** A pulled record that cannot be stored (a timestamp field that is not a valid date). It is skipped, not retried. */
export class InvalidRecord extends Error {}

/**
 * Rewrites the contract's Timestamp fields (any depth) in the app's format, `toISOString()` with milliseconds. The server
 * writes ISO_INSTANT, which drops ".000", and string comparison of the two formats misorders records within one second.
 * A Timestamp field that is not a valid date throws `InvalidRecord`.
 */
export function normalizeTimestamps(v: unknown, key?: string): unknown {
  if (typeof v === 'string' && key && TIMESTAMP_FIELDS.has(key)) {
    const iso = TIMESTAMP.test(v) ? new Date(v) : null;
    // Date rolls 2026-02-30 over to March: the parsed date must read back as the same calendar date and time.
    if (!iso || Number.isNaN(iso.getTime()) || iso.toISOString().slice(0, 19) !== v.slice(0, 19)) throw new InvalidRecord('timestamp');
    return iso.toISOString();
  }
  if (Array.isArray(v)) return v.map((x) => normalizeTimestamps(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeTimestamps(x, k)]));
  return v;
}

const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Doc)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';

/** True when two records are equal apart from `version` and `updated_at` (the idempotent-retry check of POST /sync). */
export const sameContent = (a: Doc, b: Doc): boolean => {
  const strip = (d: Doc) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'version' && k !== 'updated_at'));
  return canon(normalizeTimestamps(strip(a))) === canon(normalizeTimestamps(strip(b)));
};
