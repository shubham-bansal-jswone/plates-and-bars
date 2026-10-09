import { useCallback, useEffect, useRef, useState } from 'react';
import { saveMyFood, userFoodFacts, type CustomFoodResult } from '@plate-and-bar/core';
import { loadDayNote, loadLogs, loadUserFoods, patchDayNote, saveLog, saveUserFood } from '../db/food';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import type { CatalogFood } from './catalog';
import type { DayNote, FoodLog, Meal, UserFood } from './types';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Options {
  db: WorkoutDb;
  now: () => Date;
  /** Short message for the toast. */
  notify: (msg: string) => void;
}

/** What gets logged: per-serving values and `qty` servings; `foodId` is the shared or user food it came from. */
export type NewLog = Pick<FoodLog, 'name' | 'qty' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'> & { foodId?: string | null };

/** The shared food as a log: its per-serving values. */
export const logOf = (f: CatalogFood, qty: number): NewLog => ({
  name: f.name,
  qty,
  kcal: f.per_serving.kcal,
  protein_g: f.per_serving.protein_g,
  carbs_g: f.per_serving.carbs_g,
  fat_g: f.per_serving.fat_g,
  foodId: f.id,
});

/**
 * Today's food: loads logs, the day note and my foods from SQLite. Every action shows at once and its write
 * goes through one FIFO queue (nothing waits on the network, and writes finish in the order the user acted).
 */
export function useFoodDay({ db, now, notify }: Options) {
  const date = localDate(now());
  const [ready, setReady] = useState(false);
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [note, setNote] = useState<DayNote | null>(null);
  const [mine, setMine] = useState<UserFood[]>([]);
  const logsRef = useRef(logs);
  const noteRef = useRef(note);
  const mineRef = useRef(mine);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    (async () => {
      const [l, n, m] = await Promise.all([loadLogs(db, date), loadDayNote(db, date), loadUserFoods(db)]);
      if (!live) return;
      logsRef.current = l;
      noteRef.current = n;
      mineRef.current = m;
      setLogs(l);
      setNote(n);
      setMine(m);
      setReady(true);
    })().catch(() => {
      if (live) notify('Couldn’t read your saved food.');
    });
    return () => {
      live = false;
    };
  }, [db, date, notify]);

  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      queue.current = queue.current.then(write).catch(() => notify('Couldn’t save that. Try again.'));
    },
    [notify],
  );

  const add = useCallback(
    (meal: Meal, n: NewLog) => {
      const log: FoodLog = {
        id: newId(),
        version: 0,
        updated_at: stamp(now()),
        deleted_at: null,
        date,
        meal,
        name: n.name,
        qty: n.qty,
        kcal: n.kcal,
        protein_g: n.protein_g,
        carbs_g: n.carbs_g,
        fat_g: n.fat_g,
        food_id: n.foodId ?? null,
      };
      logsRef.current = [...logsRef.current, log];
      setLogs(logsRef.current);
      enqueue(() => saveLog(db, log));
    },
    [db, date, now, enqueue],
  );

  const remove = useCallback(
    (id: string) => {
      const gone = logsRef.current.find((l) => l.id === id);
      if (!gone) return;
      const tomb = { ...gone, deleted_at: stamp(now()), updated_at: stamp(now()) };
      logsRef.current = logsRef.current.filter((l) => l.id !== id);
      setLogs(logsRef.current);
      enqueue(() => saveLog(db, tomb));
    },
    [db, now, enqueue],
  );

  const setComplete = useCallback(
    (complete: boolean) => {
      const n: DayNote = { ...(noteRef.current ?? { id: null, version: 0, deleted_at: null, date, steps: null, sleep: null, fast: false }), complete, updated_at: stamp(now()) };
      noteRef.current = n;
      setNote(n);
      enqueue(() => patchDayNote(db, date, { complete }, n.updated_at));
    },
    [db, date, now, enqueue],
  );

  const setFast = useCallback(
    (fast: boolean) => {
      const n: DayNote = { ...(noteRef.current ?? { id: null, version: 0, deleted_at: null, date, complete: null, steps: null, sleep: null, fast: false }), fast, updated_at: stamp(now()) };
      noteRef.current = n;
      setNote(n);
      enqueue(() => patchDayNote(db, date, { fast }, n.updated_at));
    },
    [db, date, now, enqueue],
  );

  /** Saves a custom food to my foods (core's `saveMyFood`: newest first, same name replaced, capped); foods pushed out are tombstoned. */
  const saveMine = useCallback(
    (food: Extract<CustomFoodResult, { kind: 'ok' }>['food']) => {
      const t = stamp(now());
      const same = mineRef.current.find((f) => f.name === food.name);
      const rec: UserFood = { ...food, id: same?.id ?? newId(), version: same?.version ?? 0, updated_at: t, deleted_at: null };
      const next = saveMyFood(mineRef.current, rec);
      const dropped = mineRef.current.filter((f) => f.name !== food.name && !next.includes(f)).map((f) => ({ ...f, deleted_at: t, updated_at: t }));
      mineRef.current = next;
      setMine(next);
      enqueue(async () => {
        await saveUserFood(db, rec);
        for (const d of dropped) await saveUserFood(db, d);
      });
      return rec;
    },
    [db, now, enqueue],
  );

  return { date, ready, logs, note, mine, mineFacts: mine.map(userFoodFacts), add, remove, setComplete, setFast, saveMine };
}
