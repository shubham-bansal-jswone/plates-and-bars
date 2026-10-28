import { lbToKg, type WeightUnit } from './weightUnit';

/**
 * Import of workout history from a Strong or Hevy CSV export (#1179). New, no prototype counterpart. Pure: the app
 * reads the file, asks the user, and writes the result; nothing here touches storage, the network or the clock.
 * The file is untrusted: it is size and row capped, parsed by hand (no eval), and a wrong file returns an error and nothing else.
 */

export type ImportSource = 'strong' | 'hevy';

/** The largest file read (characters; the app also checks the byte size before reading). */
export const IMPORT_MAX_CHARS = 5 * 1024 * 1024;
/** The most data rows read. */
export const IMPORT_MAX_ROWS = 50_000;
/** The most distinct days one import writes. */
export const IMPORT_MAX_DAYS = 3_000;
/** The most distinct exercises in one day: the contract's `Workout.exercises` maxItems. */
export const IMPORT_MAX_EXERCISES = 50;

export type ImportError = 'empty' | 'too_large' | 'too_many_rows' | 'not_recognised';

/** One work set as read: weight in kg, whole reps. */
export interface ImportSet {
  exercise: string;
  weightKg: number | null;
  reps: number;
}

/** One calendar day of the file (two workouts on the same day are joined into one: the app keeps one workout per day). */
export interface ImportDay {
  /** `YYYY-MM-DD`, the local date written in the file. */
  date: string;
  title: string;
  sets: ImportSet[];
}

export interface ImportSkipped {
  /** Warm-up sets (Strong set order `W`, Hevy set type `warmup`). */
  warmup: number;
  /** Distance or time rows with no reps: the app's sets are weight and reps. */
  cardio: number;
  /** Rows that are not a set the app can store (bad date, number or name, over a limit). */
  invalid: number;
  /** Sets of a 51st or later exercise of one day (the contract keeps 50 per workout): the first 50 exercises are kept. */
  tooManyExercises: number;
  /** Rows dated after `today`. */
  future: number;
  /** Exact repeats of a row already read from the same workout. */
  duplicate: number;
}

export interface ImportParsed {
  source: ImportSource;
  /** The unit the weights were written in (Hevy: from the header; Strong: the one the caller gave). */
  unit: WeightUnit;
  days: ImportDay[];
  sets: number;
  firstDate: string | null;
  lastDate: string | null;
  skipped: ImportSkipped;
}

export type ImportResult = { ok: true; parsed: ImportParsed } | { ok: false; error: ImportError };

/**
 * Splits CSV text into rows of cells. Handles a leading BOM, quoted cells (with `""` for a quote and newlines inside),
 * and CRLF, LF or CR line ends. Blank lines are dropped. An unclosed quote ends at the end of the text.
 * Reading stops as soon as `maxRows` rows are read (a hostile file never becomes millions of rows in memory).
 */
export function parseCsv(text: string, delimiter: string, maxRows: number = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (rows.length < maxRows && (cell !== '' || row.length > 0)) endRow();
  return rows;
}

/** `;`, tab or `,`: whichever the header line uses most (exports vary by locale). */
function delimiterOf(text: string): string {
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n|\r/, 1)[0] ?? '';
  const count = (c: string) => head.split(c).length - 1;
  const best = [';', '\t'].reduce((a, c) => (count(c) > count(a) ? c : a), ',');
  return best;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const realDate = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * The calendar date of a cell, as written (local wall time, no time zone shift): `2024-03-27 18:30:00`, `2024-03-27T18:30`,
 * or Hevy's `27 Mar 2024, 18:30` and `Mar 27, 2024, 18:30`. Null for anything else or a date that does not exist.
 */
export function importDate(cell: string): string | null {
  const s = cell.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/.exec(s);
  if (iso) return realDate(+iso[1]!, +iso[2]!, +iso[3]!);
  const hevy = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{4})(?:,|\s|$)/.exec(s);
  if (hevy) {
    const m = MONTHS.indexOf(hevy[2]!.toLowerCase());
    return m < 0 ? null : realDate(+hevy[3]!, m + 1, +hevy[1]!);
  }
  const us = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})(?:,|\s|$)/.exec(s);
  if (us) {
    const m = MONTHS.indexOf(us[1]!.toLowerCase());
    return m < 0 ? null : realDate(+us[3]!, m + 1, +us[2]!);
  }
  return null;
}

const NUMBER = /^\d+(?:[.,]\d+)?$/;
/** A plain non-negative number, `.` or `,` as the decimal mark; null for blank, signs, exponents, thousands separators and text. Blank is `''`. */
function num(cell: string | undefined): number | null | '' {
  const s = (cell ?? '').trim();
  if (s === '') return '';
  if (!NUMBER.test(s)) return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const NAME_MAX = 200;
const WEIGHT_MAX_KG = 1000;
const REPS_MAX = 1000;

type Row = { group: string; date: string | null; title: string; exercise: string; kind: 'work' | 'warmup' | 'other'; weight: number | null | ''; reps: number | null | ''; hasDistanceOrTime: boolean };

const columns = (header: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  header.forEach((h, i) => {
    const k = h.replace(/^﻿/, '').trim().toLowerCase();
    if (!m.has(k)) m.set(k, i);
  });
  return m;
};

/**
 * Reads the CSV text of a Strong or Hevy export into work sets by day, with the counts of what was left out.
 * Rows dated after `today` (`YYYY-MM-DD`, passed in; none are turned away when omitted) are counted as `future`.
 * `strongUnit` is the unit of a Strong file (its export does not say); a Hevy file says it in its weight column (`weight_kg` or
 * `weight_lbs`) and `strongUnit` is ignored. A file that is not the chosen app's export, is empty, or is over a cap is an error with nothing read.
 */
export function parseWorkoutCsv(text: string, source: ImportSource, strongUnit: WeightUnit = 'kg', today?: string): ImportResult {
  if (text.length > IMPORT_MAX_CHARS) return { ok: false, error: 'too_large' };
  if (text.trim() === '') return { ok: false, error: 'empty' };
  const table = parseCsv(text, delimiterOf(text), IMPORT_MAX_ROWS + 2);
  if (table.length - 1 > IMPORT_MAX_ROWS) return { ok: false, error: 'too_many_rows' };
  const header = table[0];
  if (!header) return { ok: false, error: 'empty' };
  const col = columns(header);
  const at = (names: readonly string[]): number | undefined => names.map((n) => col.get(n)).find((i) => i !== undefined);

  let unit: WeightUnit = strongUnit;
  const c =
    source === 'strong'
      ? { date: at(['date']), title: at(['workout name']), ex: at(['exercise name']), order: at(['set order']), weight: at(['weight']), reps: at(['reps']), dist: at(['distance']), secs: at(['seconds']), end: undefined, type: undefined }
      : { date: at(['start_time']), title: at(['title']), ex: at(['exercise_title']), order: at(['set_index']), weight: at(['weight_kg', 'weight_lbs', 'weight_lb']), reps: at(['reps']), dist: at(['distance_km', 'distance_miles', 'distance_meters', 'distance_m']), secs: at(['duration_seconds']), end: at(['end_time']), type: at(['set_type']) };
  if (c.date === undefined || c.title === undefined || c.ex === undefined || c.order === undefined || c.weight === undefined || c.reps === undefined) return { ok: false, error: 'not_recognised' };
  if (source === 'hevy') unit = col.has('weight_kg') ? 'kg' : 'lb';

  const skipped: ImportSkipped = { warmup: 0, cardio: 0, invalid: 0, tooManyExercises: 0, future: 0, duplicate: 0 };
  const days = new Map<string, ImportDay>();
  const seen = new Set<string>();
  // Per workout: the exercise of the previous row and how many blocks of each exercise have started (set numbers restart in each block).
  const last = new Map<string, string>();
  const blocks = new Map<string, number>();
  const names = new Map<string, Set<string>>();
  const get = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());

  for (const r of table.slice(1)) {
    const exercise = get(r, c.ex);
    const order = get(r, c.order);
    const date = importDate(get(r, c.date));
    const wcell = num(get(r, c.weight));
    const rcell = num(get(r, c.reps));
    const timed = num(get(r, c.dist)) !== '' || num(get(r, c.secs)) !== '';
    const group = `${get(r, c.date)}|${get(r, c.title)}|${get(r, c.end)}`;
    const kind: Row['kind'] =
      source === 'strong' ? (/^w$/i.test(order) ? 'warmup' : /^(\d+|d|f)$/i.test(order) ? 'work' : 'other') : /^warm/i.test(get(r, c.type)) ? 'warmup' : 'work';
    const row: Row = { group, date, title: get(r, c.title), exercise, kind, weight: wcell, reps: rcell, hasDistanceOrTime: timed };

    if (row.kind === 'warmup') {
      skipped.warmup++;
      continue;
    }
    if (!row.date || row.kind === 'other' || row.exercise === '' || row.exercise.length > NAME_MAX || row.weight === null || row.reps === null) {
      skipped.invalid++;
      continue;
    }
    if (today !== undefined && row.date > today) {
      skipped.future++;
      continue;
    }
    if (row.reps === '' || row.reps === 0) {
      if (row.hasDistanceOrTime) skipped.cardio++;
      else skipped.invalid++;
      continue;
    }
    if (!Number.isInteger(row.reps) || row.reps > REPS_MAX) {
      skipped.invalid++;
      continue;
    }
    const weightKg = row.weight === '' ? null : unit === 'lb' ? lbToKg(row.weight) : row.weight;
    if (weightKg !== null && weightKg > WEIGHT_MAX_KG) {
      skipped.invalid++;
      continue;
    }
    // Dedupe: a set number repeated with the same weight and reps inside one block of an exercise counts once. A second block of the same exercise in a workout is kept.
    if (last.get(row.group) !== row.exercise) blocks.set(`${row.group}|${row.exercise}`, (blocks.get(`${row.group}|${row.exercise}`) ?? 0) + 1);
    last.set(row.group, row.exercise);
    const key = `${row.group}|${row.exercise}|${blocks.get(`${row.group}|${row.exercise}`)}|${order}|${row.weight}|${row.reps}`;
    if (seen.has(key)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(key);
    const day = days.get(row.date) ?? { date: row.date, title: '', sets: [] };
    if (!days.has(row.date)) days.set(row.date, day);
    const have = names.get(row.date) ?? new Set<string>();
    names.set(row.date, have);
    if (!have.has(row.exercise) && have.size >= IMPORT_MAX_EXERCISES) {
      skipped.tooManyExercises++;
      continue;
    }
    have.add(row.exercise);
    const title = row.title === '' ? 'Imported workout' : row.title;
    if (!day.title.split(' + ').includes(title)) day.title = day.title === '' ? title : `${day.title} + ${title}`;
    day.sets.push({ exercise: row.exercise, weightKg, reps: row.reps });
  }

  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const left = skipped.warmup + skipped.cardio + skipped.invalid + skipped.duplicate + skipped.future + skipped.tooManyExercises;
  if (list.length === 0 && left === 0) return { ok: false, error: 'empty' };
  if (list.length === 0 && skipped.warmup + skipped.cardio + skipped.future === 0) return { ok: false, error: 'not_recognised' };
  if (list.length > IMPORT_MAX_DAYS) return { ok: false, error: 'too_many_rows' };
  for (const d of list) d.title = d.title.slice(0, NAME_MAX);
  return {
    ok: true,
    parsed: { source, unit, days: list, sets: list.reduce((n, d) => n + d.sets.length, 0), firstDate: list[0]?.date ?? null, lastDate: list[list.length - 1]?.date ?? null, skipped },
  };
}

const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'smith machine', 'kettlebell', 'bodyweight'];
/** Compare key of an exercise name: case, spacing and punctuation are ignored; `Bench Press (Barbell)` reads as `Barbell Bench Press`; a trailing plural `s` is ignored. */
export function exerciseKey(name: string): string {
  let n = name.trim();
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(n);
  if (m && EQUIPMENT.includes(m[2]!.trim().toLowerCase())) n = `${m[2]!.trim()} ${m[1]!}`;
  const k = n.toLowerCase().replace(/[^a-z0-9]/g, '');
  return k.length > 3 ? k.replace(/s$/, '') : k;
}

/** The catalogue name for an imported name: an exact match, else one that matches ignoring case and the forms above; null when there is none. */
export function matchExercise(name: string, catalogue: readonly string[]): string | null {
  const exact = catalogue.find((n) => n === name);
  if (exact !== undefined) return exact;
  const lower = name.trim().toLowerCase();
  const ci = catalogue.find((n) => n.toLowerCase() === lower);
  if (ci !== undefined) return ci;
  const key = exerciseKey(name);
  return key === '' ? null : (catalogue.find((n) => exerciseKey(n) === key) ?? null);
}

export interface ImportMatches {
  /** Imported name to catalogue name. */
  matched: Record<string, string>;
  /** Imported names with no catalogue match, in order of first use. */
  unmatched: string[];
}

/** Sorts the imported exercise names into matched and unmatched against the catalogue (built-in and custom names). */
export function matchAll(days: readonly ImportDay[], catalogue: readonly string[]): ImportMatches {
  const matched: Record<string, string> = Object.create(null) as Record<string, string>;
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const d of days)
    for (const s of d.sets) {
      if (seen.has(s.exercise)) continue;
      seen.add(s.exercise);
      const hit = matchExercise(s.exercise, catalogue);
      if (hit === null) unmatched.push(s.exercise);
      else matched[s.exercise] = hit;
    }
  return { matched: { ...matched }, unmatched };
}

/** A day with its sets named for the app and numbered: `setIndex` counts from 0 per exercise in the day, in file order. */
export interface ImportWorkoutDay {
  date: string;
  title: string;
  sets: { exercise: string; setIndex: number; weightKg: number | null; reps: number }[];
}

export interface ImportPlan {
  days: ImportWorkoutDay[];
  /** Sets written. */
  sets: number;
  /** Sets left out because the user skipped their exercise. */
  skippedExercise: number;
  /** Days left out because the app already has a workout on them (`YYYY-MM-DD`, oldest first). */
  occupied: string[];
}

/**
 * The plan to write: every set renamed by `mapping` (imported name to the name to store; null or missing skips the set),
 * days the app already has (`occupiedDates`) left out whole, and sets numbered per exercise per day. Never overwrites a day.
 */
export function planImport(days: readonly ImportDay[], mapping: Readonly<Record<string, string | null | undefined>>, occupiedDates: ReadonlySet<string>): ImportPlan {
  const out: ImportWorkoutDay[] = [];
  const occupied: string[] = [];
  let skippedExercise = 0;
  let sets = 0;
  for (const d of days) {
    if (occupiedDates.has(d.date)) {
      occupied.push(d.date);
      continue;
    }
    const counts = new Map<string, number>();
    const rows: ImportWorkoutDay['sets'] = [];
    for (const s of d.sets) {
      const name = Object.prototype.hasOwnProperty.call(mapping, s.exercise) ? mapping[s.exercise] : null;
      if (name === null || name === undefined) {
        skippedExercise++;
        continue;
      }
      const i = counts.get(name) ?? 0;
      counts.set(name, i + 1);
      rows.push({ exercise: name, setIndex: i, weightKg: s.weightKg, reps: s.reps });
    }
    if (rows.length === 0) continue;
    sets += rows.length;
    out.push({ date: d.date, title: d.title, sets: rows });
  }
  return { days: out, sets, skippedExercise, occupied };
}
