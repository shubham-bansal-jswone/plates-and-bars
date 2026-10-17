import type { StoreDb } from '../db/records';
import type { Workout } from '../workout/types';
import { getKv, setKv } from './store';

// The server copy a queued workout day was last merged with (#818). A pull that merges the server's day into an unpushed one
// leaves a row at the server's version whose content is a mix; when another device stores a later edit before the push, the
// row can only be merged again without bringing a removal back if the copy it grew from is known. This keeps that copy,
// one per day, in the device-local `settings` table under `sync.` (so sign-out and wipes remove it). It is dropped when the
// push settles and is only used while its version is the row's version. A request that carries the day takes the base out
// (`takeBases`) and puts it back only when the server refused the request whole: a request whose answer is lost may have been
// stored, and the base is stale from then on.

const baseKey = (date: string) => `sync.base.workouts.${date}`;

export async function setBase(db: StoreDb, date: string, copy: Workout): Promise<void> {
  await setKv(db, baseKey(date), JSON.stringify(copy));
}

export async function getBase(db: StoreDb, date: string): Promise<Workout | null> {
  const v = await getKv(db, baseKey(date));
  return v === null ? null : (JSON.parse(v) as Workout);
}

export async function forgetBase(db: StoreDb, date: string): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', baseKey(date));
}

/** The bases of these days, removed from the store for the request that carries them. */
export async function takeBases(db: StoreDb, dates: string[]): Promise<Map<string, Workout>> {
  const taken = new Map<string, Workout>();
  for (const date of dates) {
    const base = await getBase(db, date);
    if (!base) continue;
    taken.set(date, base);
    await forgetBase(db, date);
  }
  return taken;
}

export async function restoreBases(db: StoreDb, bases: Map<string, Workout>): Promise<void> {
  for (const [date, base] of bases) await setBase(db, date, base);
}
