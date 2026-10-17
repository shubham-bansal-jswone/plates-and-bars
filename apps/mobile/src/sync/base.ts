import type { StoreDb } from '../db/records';
import type { Workout } from '../workout/types';
import { getKv, setKv } from './store';

// The server copy a queued workout day was last merged with (#818). A pull that merges the server's day into an unpushed one
// leaves a row at the server's version whose content is a mix; when another device stores a later edit before the push, the
// row can only be merged again without bringing a removal back if the copy it grew from is known. This keeps that copy,
// one per day, in the device-local `settings` table under `sync.` (so sign-out and wipes remove it). It is dropped when the
// push settles and is only used while its version is the row's version.

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
