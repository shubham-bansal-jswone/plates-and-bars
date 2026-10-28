import type { Schemas } from '@plate-and-bar/api';
import { isBlank } from '../text/blank';
import { newId, type StoreDb } from './records';
import type { WorkoutDb } from './workouts';

// Saved routines (#1184, ADR 011): one JSON document per routine in the contract's Routine shape, keyed by its random id.
// Reps and weights are not stored. A delete is a tombstone (deleted_at), so sync can push it and undo can revive the same id.
// The limits are the contract's (packages/api/test-vectors/routines.json). They are checked here before anything is written.

export type Routine = Omit<Schemas['Routine'], 'exercises'> & { exercises: RoutineExercise[] };
/** Name and set count are ours; any other key is a newer client's field and is kept when the routine is rewritten. */
export type RoutineExercise = Schemas['RoutineExercise'];

export const ROUTINE_LIMITS = { nameMax: 60, exercisesMax: 50, exerciseNameMax: 200, setsMax: 20, maxLive: 100 } as const;

export type RoutineErrorCode = 'name' | 'exercises' | 'sets' | 'too_many' | 'missing';
/** A refused save. Carries a code only, never the routine's content. */
export class RoutineError extends Error {
  constructor(readonly code: RoutineErrorCode) {
    super(code);
  }
}

const len = (s: string) => [...s].length;

function checkName(name: string): string {
  const n = name.trim();
  if (isBlank(n) || len(n) > ROUTINE_LIMITS.nameMax) throw new RoutineError('name');
  return n;
}

/** The exercises as they will be stored: a repeat of a name is dropped (the first stays), every other key is untouched. */
function checkExercises(list: RoutineExercise[]): RoutineExercise[] {
  const seen = new Set<string>();
  const out: RoutineExercise[] = [];
  for (const e of list) {
    if (typeof e.name !== 'string' || isBlank(e.name) || len(e.name) > ROUTINE_LIMITS.exerciseNameMax) throw new RoutineError('exercises');
    // Bounded-open like the contract: at most 20 keys, each value a boolean, number, string up to 200, or null.
    const keys = Object.entries(e);
    if (keys.length > 20 || keys.some(([k, v]) => len(k) > 50 || (v !== null && !['boolean', 'number', 'string'].includes(typeof v)) || (typeof v === 'string' && len(v) > 200 && k !== 'name'))) throw new RoutineError('exercises');
    if (!Number.isInteger(e.sets) || e.sets < 1 || e.sets > ROUTINE_LIMITS.setsMax) throw new RoutineError('sets');
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e);
  }
  if (out.length < 1 || out.length > ROUTINE_LIMITS.exercisesMax) throw new RoutineError('exercises');
  return out;
}

const parse = (data: string): Routine | null => {
  try {
    const r = JSON.parse(data) as Routine;
    return r && typeof r.name === 'string' && Array.isArray(r.exercises) ? r : null;
  } catch {
    return null; // not JSON: skipped like any damaged row
  }
};

async function liveCount(db: WorkoutDb): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM routines WHERE json_extract(data, '$.deleted_at') IS NULL"))?.n ?? 0;
}

async function load(db: WorkoutDb, id: string): Promise<Routine> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM routines WHERE key = ?', id);
  const r = row ? parse(row.data) : null;
  if (!r) throw new RoutineError('missing');
  return r;
}

const write = (db: StoreDb, r: Routine) => db.runAsync('INSERT OR REPLACE INTO routines (key, data) VALUES (?, ?)', r.id as string, JSON.stringify(r));

/** Live routines, most recently changed first. */
export async function loadRoutines(db: WorkoutDb): Promise<Routine[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM routines');
  return rows
    .flatMap((r) => parse(r.data) ?? [])
    .filter((r) => !r.deleted_at)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.name.localeCompare(b.name));
}

/** Saves a new routine. Throws `RoutineError` (nothing written) for a bad name, exercise list or set count, or at 100 live routines. */
export async function createRoutine(db: WorkoutDb, name: string, exercises: RoutineExercise[], now: Date = new Date()): Promise<Routine> {
  const n = checkName(name);
  const list = checkExercises(exercises);
  if ((await liveCount(db)) >= ROUTINE_LIMITS.maxLive) throw new RoutineError('too_many');
  const at = now.toISOString();
  const r: Routine = { id: newId(), version: 0, updated_at: at, deleted_at: null, name: n, exercises: list, created_at: at };
  await write(db, r);
  return r;
}

/** Renames; the exercises, including keys this app does not know, are written back as stored. */
export async function renameRoutine(db: WorkoutDb, id: string, name: string, now: Date = new Date()): Promise<void> {
  const n = checkName(name);
  await write(db, { ...(await load(db, id)), name: n, updated_at: now.toISOString() });
}

/** Deletes by tombstone. */
export async function deleteRoutine(db: WorkoutDb, id: string, now: Date = new Date()): Promise<void> {
  const at = now.toISOString();
  await write(db, { ...(await load(db, id)), deleted_at: at, updated_at: at });
}

/** Brings a deleted routine back under the same id. Refused at 100 live routines, as a new one is. */
export async function undoDeleteRoutine(db: WorkoutDb, id: string, now: Date = new Date()): Promise<void> {
  const r = await load(db, id);
  if (!r.deleted_at) return;
  if ((await liveCount(db)) >= ROUTINE_LIMITS.maxLive) throw new RoutineError('too_many');
  await write(db, { ...r, deleted_at: null, updated_at: now.toISOString() });
}
