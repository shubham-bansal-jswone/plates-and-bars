import type { CycleData, LabHold, LabReport } from '@plate-and-bar/core';
import { SYNC_TABLES, inTransaction, isQueued, type PullDb, type SyncTableName } from '../db/outbox';
import type { WorkoutDb } from '../db/workouts';
import { loadCycle, saveCycle } from '../db/cycle';
import { loadHold, loadReports, saveHold, saveReport } from '../db/labs';
import { NO_USER, type LocalExport } from './exportLocal';
import { InvalidRecord, normalizeTimestamps, parseTimestamp, storeRecord, type Doc } from '../sync/records';
import { naturalId } from '../sync/ids';
import { getLiftVersion } from '../sync/store';
import { ROUTINE_EXERCISES_MAX, ROUTINE_MAX_LIVE, ROUTINE_SETS_MAX, ROUTINE_SETS_MIN, normalizeGroups } from '@plate-and-bar/core';
import { KEY_MAX, MAX_KEYS, boundedOpenOk, exerciseProblem, len, routineNameOk } from '../db/routineRules';
import { deleteKitchenPhoto } from '../photos/vault';

// Restore from a device export file (#1177). It merges by record id using the record version and tombstones, the rule sync
// uses, so it is safe on a device that already has data. Rows it writes are queued by the table triggers like any edit.
// The file is untrusted: nothing here logs or interpolates its content.

/** The server's version is a 32-bit integer. */
const MAX_VERSION = 2_147_483_647;
export const MAX_RESTORE_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 200_000;
const MAX_ROW_BYTES = 256 * 1024;
const MAX_DEPTH = 24;
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Consent is never restored from a file: the user gives it on this device. */
const SKIPPED: ReadonlySet<SyncTableName> = new Set<SyncTableName>(['consents']);
/** Parents before children, as sync stores them. */
const ORDER: SyncTableName[] = ['workouts', 'workout_sets', 'profiles', 'consents', 'food_logs', 'water_logs', 'day_notes', 'lift_stats', 'weights', 'measurements', 'user_foods', 'recipes', 'kitchen_tests', 'exclusions', 'swaps', 'settings', 'routines'];
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
  rows: { tbl: SyncTableName; key: string; rec: Doc; setDate: string | null; repaired: boolean }[];
  /** Rows left out because they are structurally invalid (the server would refuse them), by table. Never stored. */
  skipped: Partial<Record<SyncTableName, number>>;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_KEYED: ReadonlySet<SyncTableName> = new Set<SyncTableName>(['workouts', 'day_notes', 'weights', 'measurements']);
const isYmd = (v: unknown): boolean => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** The shape of a record: the key and the fields the local store indexes or the screens read must have their types. */
function shapeOk(tbl: SyncTableName, key: string, rec: Doc): boolean {
  if (DATE_KEYED.has(tbl)) return isYmd(key);
  if (tbl === 'food_logs') return UUID.test(key) && isYmd(rec.date) && typeof rec.qty === 'number';
  if (tbl === 'water_logs') return UUID.test(key) && isYmd(rec.date) && typeof rec.ml === 'number';
  if (tbl === 'workout_sets') return UUID.test(key) && typeof rec.kind === 'string' && typeof rec.done === 'boolean';
  // A live lift stat is core's record shape: its day and its sets. A tombstone carries neither.
  if (tbl === 'lift_stats') return !!key && (rec.deleted_at != null || (isYmd(rec.date) && Array.isArray(rec.sets)));
  if (tbl === 'swaps') return key.length > 0;
  if (tbl === 'routines') return UUID.test(key) && typeof rec.name === 'string' && Array.isArray(rec.exercises);
  if (tbl === 'profiles' || tbl === 'settings') return true;
  return UUID.test(key);
}

type Fixed = { rec: Doc; repaired: boolean };
type Groupable = Parameters<typeof normalizeGroups>[0];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A routine (live or tombstone: the server checks both against the full contract `Routine`) as the app would write it. The rules
 * are the ones `createRoutine` uses (db/routineRules.ts). Structurally bad is null and the row is skipped: a blank or over-long
 * name, no valid `created_at`, no exercise list or one outside 1..ROUTINE_EXERCISES_MAX, an exercise that is not an object, has a
 * blank or over-long name, breaks the bounded-open key rule or has a set count that is not an integer. Repaired and kept, and
 * counted as repaired: a set count outside the limits is clamped, and core's `normalizeGroups` nulls an invalid group id and
 * dissolves a broken group. Duplicate exercise names stay: the server accepts them.
 */
function repairRoutine(rec: Doc): Fixed | null {
  const list = rec.exercises;
  if (!routineNameOk(rec.name) || typeof rec.created_at !== 'string' || !parseTimestamp(rec.created_at)) return null;
  if (!Array.isArray(list) || list.length < 1 || list.length > ROUTINE_EXERCISES_MAX) return null;
  const clamped: Record<string, unknown>[] = [];
  for (const e of list) {
    if (!isObj(e) || exerciseProblem(e, true)) return null;
    clamped.push({ ...e, sets: Math.min(ROUTINE_SETS_MAX, Math.max(ROUTINE_SETS_MIN, e.sets as number)) });
  }
  const exercises = normalizeGroups(clamped as unknown as Groupable);
  return { rec: { ...rec, exercises }, repaired: !same(exercises, list) };
}

const FEEL = /^(target|pain|[0-9]{1,2})$/;
export const WHERE = ['gym', 'dumbbells', 'bodyweight'];
export const CI_CHOICE = ['light', 'swap', 'orig'];
export const TEXT_MAX = 200; // Workout.template and Workout.base
export const MODS_VALUE_MAX = 50; // Workout.mods unknown-key string values

/** Contract `Workout.mods`: an object of at most 20 keys (names up to 50), the listed keys typed, any other value a boolean, number, string up to 50 or null. */
function modsOk(m: unknown): boolean {
  if (!isObj(m)) return false;
  const e = Object.entries(m);
  if (e.length > MAX_KEYS) return false;
  return e.every(([k, v]) => {
    if (len(k) > KEY_MAX) return false;
    if (k === 'light' || k === 'short' || k === 'deload') return typeof v === 'boolean';
    if (k === 'where') return typeof v === 'string' && WHERE.includes(v);
    if (k === 'reentry') return typeof v === 'number' && v >= 0 && v <= 1;
    return v === null || typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && len(v) <= MODS_VALUE_MAX);
  });
}

/**
 * A workout (live or tombstone) as the contract `Workout` wants it. Structurally unrepairable is null, and the workout is skipped
 * together with its sets: no valid `mods` (emptying it would silently drop `light` or `deload`), no exercise list, more than
 * ROUTINE_EXERCISES_MAX exercises, or an exercise that is not an object, has a name over 200 characters (a string value of the
 * bounded-open rule) or breaks the bounded-open key rule. Repaired and kept, and counted as repaired. Top-level fields, required
 * and nullable, get null when invalid or missing: `template` and `base` (not a string of at most 200 code points), `where` (not
 * gym, dumbbells or bodyweight), `cardio_min` (not a number from 0; a fraction is rounded) and `ci_choice` (not light, swap or orig). Exercises:
 * `part` outside 1 or 2 becomes 1, a missing or mistyped `bridge` or `skip_ramp` becomes false, `form`, `found_kg` or `feel` become
 * null, and `normalizeGroups` nulls an invalid group id or dissolves a broken group.
 */
function repairWorkout(rec: Doc): Fixed | null {
  const list = rec.exercises;
  if (!modsOk(rec.mods) || !Array.isArray(list) || list.length > ROUTINE_EXERCISES_MAX) return null;
  const fixed: Record<string, unknown>[] = [];
  for (const e of list) {
    if (!isObj(e) || typeof e.name !== 'string' || !boundedOpenOk(e)) return null;
    const f: Record<string, unknown> = {
      ...e,
      part: e.part === 1 || e.part === 2 ? e.part : 1,
      bridge: typeof e.bridge === 'boolean' ? e.bridge : false,
      form: e.form === 'yes' || e.form === 'no' ? e.form : null,
      found_kg: typeof e.found_kg === 'number' ? e.found_kg : null,
      skip_ramp: typeof e.skip_ramp === 'boolean' ? e.skip_ramp : false,
    };
    if (f.feel != null && !(typeof f.feel === 'string' && FEEL.test(f.feel))) f.feel = null;
    if (!boundedOpenOk(f)) return null; // the neutral values added a key past the 20-key limit
    fixed.push(f);
  }
  const text = (v: unknown) => (typeof v === 'string' && len(v) <= TEXT_MAX ? v : null);
  const out: Doc = {
    ...rec,
    template: text(rec.template),
    base: text(rec.base),
    where: typeof rec.where === 'string' && WHERE.includes(rec.where) ? rec.where : null,
    cardio_min: typeof rec.cardio_min === 'number' && Number.isFinite(rec.cardio_min) && rec.cardio_min >= 0 ? Math.round(rec.cardio_min) : null,
    ci_choice: typeof rec.ci_choice === 'string' && CI_CHOICE.includes(rec.ci_choice) ? rec.ci_choice : null,
    exercises: normalizeGroups(fixed as unknown as Groupable),
  };
  return { rec: out, repaired: !same(out, rec) };
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
  if (Object.keys(tables).some((t) => !Object.hasOwn(SYNC_TABLES, t))) throw new RestoreError('bad_format');
  checkDeviceOnly(json.device_only);
  const rows: ParsedRestore['rows'] = [];
  const skipped: ParsedRestore['skipped'] = {};
  const lostWorkouts = new Set<string>(); // contract ids of workouts left out as invalid: their sets go with them
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
      const sync = typeof rec.version === 'number' && Number.isInteger(rec.version) && rec.version >= 0 && rec.version <= MAX_VERSION && typeof rec.updated_at === 'string';
      if (!key || !sync || !shapeOk(tbl, key, rec) || (rec.deleted_at != null && typeof rec.deleted_at !== 'string')) throw new RestoreError('bad_rows');
      let repaired = false;
      if (tbl === 'routines' || tbl === 'workouts') {
        const fixed = tbl === 'routines' ? repairRoutine(rec) : repairWorkout(rec);
        if (!fixed) {
          skipped[tbl] = (skipped[tbl] ?? 0) + 1;
          if (tbl === 'workouts') lostWorkouts.add(await naturalId(ns, 'workouts', key));
          continue;
        }
        ({ rec, repaired } = fixed);
      }
      if (tbl === 'workouts') dates.set(await naturalId(ns, 'workouts', key), key);
      let setDate: string | null = null;
      if (tbl === 'workout_sets') {
        if (lostWorkouts.has(String(rec.workout_id))) {
          skipped[tbl] = (skipped[tbl] ?? 0) + 1;
          continue;
        }
        setDate = dates.get(String(rec.workout_id)) ?? null;
        if (!setDate) throw new RestoreError('bad_rows'); // a set whose workout is not in the file
      }
      rows.push({ tbl, key, rec, setDate, repaired });
    }
  }
  return { file: json as unknown as LocalExport, rows, skipped };
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
  /** Routines only: live routines that would take this device past 100. The first that fit are stored, these are skipped. */
  overCap?: number;
  /** Routines, workouts and their sets: rows in the file that are not valid (the server would refuse them). Skipped, never stored. */
  invalid?: number;
  /** Routines and workouts: stored rows that were changed to fit the contract (a set count clamped, a group, part or flag corrected). */
  repaired?: number;
  /** First and last day among the file's rows of this table that have a date. */
  from?: string;
  to?: string;
}
export interface RestoreSummary {
  tables: Partial<Record<SyncTableName, TableCounts>>;
  differentAccount: boolean;
  /** Cycle and lab data in the file that this device does not have yet. */
  deviceOnly: { cycle: boolean; labReports: number; hold: boolean };
}

const stamp = (d: Doc): string => String(d.updated_at ?? d.deleted_at ?? '');

/** The sync rule: a higher version wins; the same version falls to the later `updated_at`. */
function compare(file: Doc, local: { version: number; at: string | null }): 'newer' | 'older' | 'same' {
  const v = file.version as number;
  if (v !== local.version) return v > local.version ? 'newer' : 'older';
  if (local.at === null) return 'same'; // lift stats keep no time locally: the same version is the same record
  const a = stamp(file);
  return a === local.at ? 'same' : a > local.at ? 'newer' : 'older';
}

const zero = (): TableCounts => ({ added: 0, newer: 0, older: 0, conflicts: 0, same: 0 });

interface Merged extends Omit<RestoreSummary, 'differentAccount'> {
  /** Local keys of kitchen tests the restore deleted (their photos go after the commit). */
  deletedKitchen: string[];
}

async function merge(db: WorkoutDb, parsed: ParsedRestore, apply: boolean, addOnly: boolean): Promise<Merged> {
  const deletedKitchen: string[] = [];
  const tables: RestoreSummary['tables'] = {};
  // Live routines by key, kept up to date as rows are (or would be) stored, so the 100 cap holds for the whole file.
  const live = new Set<string>();
  for (const r of await db.getAllAsync<{ key: string; data: string }>("SELECT key, data FROM routines WHERE json_valid(data) AND json_extract(data, '$.deleted_at') IS NULL")) live.add(r.key);
  for (const [t, n] of Object.entries(parsed.skipped)) (tables[t as SyncTableName] ??= zero()).invalid = n;
  // Routine tombstones go first, so one frees its slot before new routines are counted against the cap whatever the file order.
  const rows = [...parsed.rows].sort((a, b) => Number(b.tbl === 'routines' && !!b.rec.deleted_at) - Number(a.tbl === 'routines' && !!a.rec.deleted_at));
  for (const { tbl, key, rec, setDate, repaired } of rows) {
    if (SKIPPED.has(tbl)) continue;
    const c = (tables[tbl] ??= zero());
    if (typeof rec.date === 'string') {
      if (!c.from || rec.date < c.from) c.from = rec.date;
      if (!c.to || rec.date > c.to) c.to = rec.date;
    }
    const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${SYNC_TABLES[tbl]} WHERE key = ?`, key);
    let outcome: keyof TableCounts;
    if (!row) outcome = 'added';
    else if (addOnly) outcome = 'older'; // another account's version counters mean nothing here: what exists is kept
    else if (await isQueued(db, tbl, key)) outcome = 'conflicts';
    else {
      const doc = JSON.parse(row.data) as Doc;
      outcome = compare(rec, { version: tbl === 'lift_stats' ? await getLiftVersion(db, key) : Number(doc.version ?? 0), at: tbl === 'lift_stats' ? null : stamp(doc) });
    }
    if (tbl === 'routines' && (outcome === 'added' || outcome === 'newer')) {
      if (!rec.deleted_at && !live.has(key) && live.size >= ROUTINE_MAX_LIVE) {
        c.overCap = (c.overCap ?? 0) + 1; // ADR 011: the server would refuse it; skipped here instead
        continue;
      }
      if (rec.deleted_at) live.delete(key);
      else live.add(key);
    }
    c[outcome]++;
    if (repaired && (outcome === 'added' || outcome === 'newer')) c.repaired = (c.repaired ?? 0) + 1;
    // The table triggers queue the write, so it syncs up like any edit made here.
    if (apply && (outcome === 'added' || outcome === 'newer')) {
      await storeRecord(db, tbl, rec, setDate);
      // A lift stat is pushed with its queued time as `updated_at`: keep the file's own, so a restore never wins by timestamp.
      if (tbl === 'lift_stats') await db.runAsync("UPDATE sync_outbox SET queued_at = ? WHERE tbl = 'lift_stats' AND key = ?", stamp(rec), key);
      if (tbl === 'kitchen_tests' && rec.deleted_at) deletedKitchen.push(key);
    }
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
  return { tables, deviceOnly: { cycle, labReports: reports.length, hold }, deletedKitchen };
}

export const otherAccount = (parsed: ParsedRestore, localUser: string | null) => !!parsed.file.user_id && !!localUser && parsed.file.user_id !== localUser;

/** What restoring would do. Reads only. */
export async function previewRestore(db: WorkoutDb, parsed: ParsedRestore, localUser: string | null): Promise<RestoreSummary> {
  const { deletedKitchen: _k, ...m } = await merge(db, parsed, false, otherAccount(parsed, localUser));
  return { ...m, differentAccount: otherAccount(parsed, localUser) };
}

/** Applies the merge in one transaction: any failure rolls everything back. */
export async function applyRestore(db: WorkoutDb & PullDb, parsed: ParsedRestore, localUser: string | null): Promise<RestoreSummary> {
  let out: Merged | null = null;
  // The transaction object is the same database connection; it only lacks the read type the helpers declare.
  await inTransaction(db, async (txn) => {
    out = await merge(txn as WorkoutDb, parsed, true, otherAccount(parsed, localUser));
  });
  const { deletedKitchen, ...m } = out as unknown as Merged;
  // As a pulled tombstone does: after the commit, the serving photo of a deleted kitchen test goes too.
  for (const id of deletedKitchen) await deleteKitchenPhoto(id).catch(() => undefined);
  return { ...m, differentAccount: otherAccount(parsed, localUser) };
}
