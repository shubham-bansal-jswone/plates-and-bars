import type { CycleData, LabHold, LabReport } from '@plate-and-bar/core';
import { SYNC_TABLES, inTransaction, isQueued, type PullDb, type SyncTableName } from '../db/outbox';
import type { WorkoutDb } from '../db/workouts';
import { loadCycle, saveCycle } from '../db/cycle';
import { loadHold, loadReports, saveHold, saveReport } from '../db/labs';
import { NO_USER, type LocalExport } from './exportLocal';
import { InvalidRecord, normalizeTimestamps, storeRecord, type Doc } from '../sync/records';
import { naturalId } from '../sync/ids';
import { getLiftVersion } from '../sync/store';

// Restore from a device export file (#1177). It merges by record id using the record version and tombstones, the rule sync
// uses, so it is safe on a device that already has data. Rows it writes are queued by the table triggers like any edit.
// The file is untrusted: nothing here logs or interpolates its content.

export const MAX_RESTORE_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 200_000;
const MAX_ROW_BYTES = 256 * 1024;
const MAX_DEPTH = 24;
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Consent is never restored from a file: the user gives it on this device. */
const SKIPPED: ReadonlySet<SyncTableName> = new Set<SyncTableName>(['consents']);
/** Parents before children, as sync stores them. */
const ORDER: SyncTableName[] = ['workouts', 'workout_sets', 'profiles', 'consents', 'food_logs', 'water_logs', 'day_notes', 'lift_stats', 'weights', 'measurements', 'user_foods', 'recipes', 'kitchen_tests', 'exclusions', 'swaps', 'settings'];
/** The record field that is the local key; the tables not listed are keyed by their random `id`, and profiles and settings by 'me'. */
const KEY_FIELD: Partial<Record<SyncTableName, string>> = { day_notes: 'date', workouts: 'date', weights: 'date', measurements: 'date', lift_stats: 'exercise', swaps: 'from' };

export type RestoreErrorCode = 'too_large' | 'not_json' | 'bad_format' | 'bad_version' | 'bad_rows' | 'unsafe';
/** A refused file. Carries a code only, never any content of the file. */
export class RestoreError extends Error {
  constructor(readonly code: RestoreErrorCode) {
    super(code);
  }
}

export interface ParsedRestore {
  file: LocalExport;
  /** Rows with timestamps normalised and the workout date of each set resolved. */
  rows: { tbl: SyncTableName; key: string; rec: Doc; setDate: string | null }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** No prototype-pollution key at any depth, and a depth limit. */
function checkSafe(root: unknown): void {
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop() as [unknown, number];
    if (!v || typeof v !== 'object') continue;
    if (d > MAX_DEPTH) throw new RestoreError('bad_format');
    for (const [k, x] of Object.entries(v)) {
      if (UNSAFE_KEYS.has(k)) throw new RestoreError('unsafe');
      stack.push([x, d + 1]);
    }
  }
}

function checkDeviceOnly(d: unknown): void {
  if (!isObj(d)) throw new RestoreError('bad_format');
  const c = d.cycle;
  if (c !== undefined && !(isObj(c) && typeof c.on === 'boolean' && Array.isArray(c.starts) && c.starts.length <= 5000 && c.starts.every((s) => typeof s === 'string' && YMD.test(s)) && typeof c.len === 'number' && c.len > 0 && c.len < 1000)) throw new RestoreError('bad_rows');
  const l = d.labs;
  if (l === undefined) return;
  const str = (v: unknown) => typeof v === 'string' && v.length <= 200;
  const test = (t: unknown) => isObj(t) && str(t.name) && str(t.value) && str(t.unit) && str(t.low) && str(t.high);
  const ok = isObj(l) && Array.isArray(l.reports) && l.reports.length <= 5000
    && l.reports.every((r) => isObj(r) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 100 && !r.id.includes('|') && typeof r.date === 'string' && YMD.test(r.date) && Array.isArray(r.tests) && r.tests.length <= 500 && r.tests.every(test))
    && (l.hold === null || (isObj(l.hold) && typeof l.hold.on === 'boolean' && (l.hold.since === undefined || (typeof l.hold.since === 'string' && YMD.test(l.hold.since)))));
  if (!ok) throw new RestoreError('bad_rows');
}

/** The local key of a record, or '' when the field that holds it is missing or not a usable string. */
function keyOf(tbl: SyncTableName, rec: Doc): string {
  if (tbl === 'profiles' || tbl === 'settings') return 'me';
  const v = rec[KEY_FIELD[tbl] ?? 'id'];
  return typeof v === 'string' && v.length <= 200 ? v : '';
}

/** Validates the text of an export file strictly. Throws `RestoreError`; touches nothing. */
export async function parseRestore(text: string): Promise<ParsedRestore> {
  if (text.length > MAX_RESTORE_BYTES) throw new RestoreError('too_large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RestoreError('not_json');
  }
  checkSafe(json);
  if (!isObj(json) || json.source !== 'device' || !isObj(json.tables)) throw new RestoreError('bad_format');
  if (json.format_version !== 1) throw new RestoreError('bad_version');
  if (typeof json.exported_at !== 'string' || (json.user_id !== null && typeof json.user_id !== 'string')) throw new RestoreError('bad_format');
  const tables = json.tables;
  if (Object.keys(tables).some((t) => !(t in SYNC_TABLES))) throw new RestoreError('bad_format');
  checkDeviceOnly(json.device_only);
  const rows: ParsedRestore['rows'] = [];
  const ns = (json.user_id as string | null) ?? NO_USER;
  const dates = new Map<string, string>(); // contract workout id -> date, from this file
  let count = 0;
  for (const tbl of ORDER) {
    const list = tables[tbl];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new RestoreError('bad_rows');
    count += list.length;
    if (count > MAX_ROWS) throw new RestoreError('too_large');
    for (const raw of list) {
      if (!isObj(raw) || JSON.stringify(raw).length > MAX_ROW_BYTES) throw new RestoreError('bad_rows');
      let rec: Doc;
      try {
        rec = normalizeTimestamps(raw) as Doc;
      } catch (e) {
        if (e instanceof InvalidRecord) throw new RestoreError('bad_rows');
        throw e;
      }
      const key = keyOf(tbl, rec);
      const sync = typeof rec.version === 'number' && Number.isInteger(rec.version) && rec.version >= 0 && (tbl === 'lift_stats' || typeof rec.updated_at === 'string');
      if (!key || !sync || (rec.deleted_at != null && typeof rec.deleted_at !== 'string')) throw new RestoreError('bad_rows');
      if (tbl === 'workouts') dates.set(await naturalId(ns, 'workouts', key), key);
      let setDate: string | null = null;
      if (tbl === 'workout_sets') {
        setDate = dates.get(String(rec.workout_id)) ?? null;
        if (!setDate) throw new RestoreError('bad_rows'); // a set whose workout is not in the file
      }
      rows.push({ tbl, key, rec, setDate });
    }
  }
  return { file: json as unknown as LocalExport, rows };
}

export interface TableCounts {
  /** Not on this device: stored. */
  added: number;
  /** The file's copy is newer: replaces this device's (a tombstone deletes). */
  newer: number;
  /** This device's copy is newer: kept. */
  older: number;
  /** This device has an edit not pushed yet: kept, for sync to settle. */
  conflicts: number;
  /** Same version and time: nothing to do. */
  same: number;
}
export interface RestoreSummary {
  tables: Partial<Record<SyncTableName, TableCounts>>;
  differentAccount: boolean;
  /** Cycle and lab data in the file that this device does not have yet. */
  deviceOnly: { cycle: boolean; labReports: number; hold: boolean };
}

const stamp = (d: Doc): string => String(d.updated_at ?? d.deleted_at ?? '');

/** The sync rule: a higher version wins; the same version falls to the later `updated_at`. */
function compare(file: Doc, local: { version: number; at: string }): 'newer' | 'older' | 'same' {
  const v = file.version as number;
  if (v !== local.version) return v > local.version ? 'newer' : 'older';
  const a = stamp(file);
  return a === local.at ? 'same' : a > local.at ? 'newer' : 'older';
}

const zero = (): TableCounts => ({ added: 0, newer: 0, older: 0, conflicts: 0, same: 0 });

async function merge(db: WorkoutDb, parsed: ParsedRestore, apply: boolean): Promise<Omit<RestoreSummary, 'differentAccount'>> {
  const tables: RestoreSummary['tables'] = {};
  for (const { tbl, key, rec, setDate } of parsed.rows) {
    if (SKIPPED.has(tbl)) continue;
    const c = (tables[tbl] ??= zero());
    const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${SYNC_TABLES[tbl]} WHERE key = ?`, key);
    let outcome: keyof TableCounts;
    if (!row) outcome = 'added';
    else if (await isQueued(db, tbl, key)) outcome = 'conflicts';
    else {
      const doc = JSON.parse(row.data) as Doc;
      outcome = compare(rec, { version: tbl === 'lift_stats' ? await getLiftVersion(db, key) : Number(doc.version ?? 0), at: stamp(doc) });
    }
    c[outcome]++;
    // The table triggers queue the write, so it syncs up like any edit made here.
    if (apply && (outcome === 'added' || outcome === 'newer')) await storeRecord(db, tbl, rec, setDate);
  }
  const d = parsed.file.device_only;
  const mine = await loadCycle(db);
  const cycle = !!d.cycle && !mine.on && mine.starts.length === 0;
  const have = new Set((await loadReports(db)).map((r) => `${r.date}|${r.id}`));
  const reports = (d.labs?.reports ?? []).filter((r) => !have.has(`${r.date}|${r.id}`));
  const hold = !!d.labs?.hold?.on && !(await loadHold(db))?.on; // the hold protects: a file can turn it on, never off
  if (apply) {
    if (cycle) await saveCycle(db, d.cycle as CycleData);
    for (const r of reports as LabReport[]) await saveReport(db, r);
    if (hold) await saveHold(db, d.labs?.hold as LabHold);
  }
  return { tables, deviceOnly: { cycle, labReports: reports.length, hold } };
}

const otherAccount = (parsed: ParsedRestore, localUser: string | null) => !!parsed.file.user_id && !!localUser && parsed.file.user_id !== localUser;

/** What restoring would do. Reads only. */
export async function previewRestore(db: WorkoutDb, parsed: ParsedRestore, localUser: string | null): Promise<RestoreSummary> {
  return { ...(await merge(db, parsed, false)), differentAccount: otherAccount(parsed, localUser) };
}

/** Applies the merge in one transaction: any failure rolls everything back. */
export async function applyRestore(db: WorkoutDb & PullDb, parsed: ParsedRestore, localUser: string | null): Promise<RestoreSummary> {
  let out: Omit<RestoreSummary, 'differentAccount'> | null = null;
  // The transaction object is the same database connection; it only lacks the read type the helpers declare.
  await inTransaction(db, async (txn) => {
    out = await merge(txn as WorkoutDb, parsed, true);
  });
  return { ...(out as unknown as Omit<RestoreSummary, 'differentAccount'>), differentAccount: otherAccount(parsed, localUser) };
}
