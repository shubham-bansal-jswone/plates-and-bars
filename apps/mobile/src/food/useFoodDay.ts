import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, myFoodReplaced, saveMyFood, userFoodFacts, type UserFoodFields } from '@plate-and-bar/core';
import { loadDayNote, loadLogs, loadUserFoods, patchDayNote, saveLog, saveUserFood } from '../db/food';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { freshRead } from '../state/freshRead';
import { stepsSleepSave } from '../progress/stepsSleep';
import type { CatalogFood } from './catalog';
import type { DayNote, FoodLog, Meal, UserFood } from './types';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

interface Options {
  db: WorkoutDb;
  /** The day shown (the viewed day, which may be a past one): every read and write is for it. */
  date: string;
  now: () => Date;
  /** Short message for the toast. */
  notify: (msg: string) => void;
  /** Changes when sync stored pulled records: the day is read again (after queued local writes). */
  reloadKey?: number;
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
 * The shown day's food: loads logs, the day note and my foods from SQLite. Every action shows at once and its write
 * goes through one FIFO queue (nothing waits on the network, and writes finish in the order the user acted).
 */
export function useFoodDay({ db, date, now, notify, reloadKey = 0 }: Options) {
  /** The day the shown logs belong to: not ready while the viewed day is another one, so nothing can be written against stale rows. */
  const [loaded, setLoaded] = useState<string | null>(null);
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [note, setNote] = useState<DayNote | null>(null);
  const [mine, setMine] = useState<UserFood[]>([]);
  const logsRef = useRef(logs);
  const noteRef = useRef(note);
  const mineRef = useRef(mine);
  const [failed, setFailed] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Counts this screen's writes, so a read that overlapped one is redone. */
  const writes = useRef(0);

  // The tab stays mounted under the Recipes screen, which saves foods and logs, so everything is read again when it is shown
  // (not on the first show: the mount already reads).
  const [shown, setShown] = useState(0);
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false;
      else setShown((n) => n + 1);
    }, []),
  );

  useEffect(() => {
    let live = true;
    (async () => {
      await freshRead({ queue, writes }, () => Promise.all([loadLogs(db, date), loadDayNote(db, date), loadUserFoods(db)]), () => live, ([l, n, m]) => {
        logsRef.current = l;
        noteRef.current = n;
        mineRef.current = m;
        setLogs(l);
        setNote(n);
        setMine(m);
        setLoaded(date);
      });
    })().catch(() => {
      if (!live) return;
      setFailed(true);
      notify('Couldn’t read your saved food.');
    });
    return () => {
      live = false;
    };
  }, [db, date, notify, shown, reloadKey]);

  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      writes.current++;
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

  /**
   * The prototype's "Copy previous day": every non-deleted log of yesterday is copied to today with a new id, as stored
   * (name, meal, qty and values), whether or not the food is still in the list.
   *
   * Returns false, having copied nothing, on every path that is not a copy: a tap while another copy is still reading;
   * an empty yesterday ("Nothing was logged the day before."); a day that gained a log while we read it (a sync pull or
   * another screen — silent, because the copy is no longer wanted); and a read that fails
   * ("Couldn’t read your saved food.").
   */
  const copying = useRef(false);
  const copyPrevious = useCallback(async (): Promise<boolean> => {
    if (copying.current) return false; // a second tap while the first is still reading
    copying.current = true;
    try {
      await queue.current; // earlier local writes land first
      const prev = await loadLogs(db, addDays(date, -1));
      // Yesterday is checked first, as the prototype does, so "nothing the day before" is said even when the day gained a log while we read.
      if (!prev.length) {
        notify('Nothing was logged the day before.');
        return false;
      }
      // The day got logs (a sync pull, another screen) while we waited: it is not empty any more, so there is nothing to copy and no toast.
      if (logsRef.current.length) return false;
      const t = stamp(now());
      const copies = prev.map((l): FoodLog => ({ ...l, id: newId(), version: 0, updated_at: t, deleted_at: null, date }));
      logsRef.current = [...logsRef.current, ...copies];
      setLogs(logsRef.current);
      // A save that fails part way keeps the logs already stored, like other multi-write flows; enqueue shows the generic save toast.
      enqueue(async () => {
        for (const c of copies) await saveLog(db, c);
      });
      notify('Copied the previous day’s meals');
      return true;
    } catch {
      notify('Couldn’t read your saved food.');
      return false;
    } finally {
      copying.current = false;
    }
  }, [db, date, now, enqueue, notify]);

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

  /** Saves steps and sleep on the day note (the same rule and write as Progress); false when an entry was refused, with the toast. */
  const saveStepsSleep = useCallback(
    (stepsText: string, sleepText: string): boolean => {
      const r = stepsSleepSave(stepsText, sleepText, noteRef.current);
      if (r.kind === 'bad') {
        notify(r.message);
        return false;
      }
      const { steps, steps_source, sleep, stepsChanged } = r;
      const n: DayNote = { ...(noteRef.current ?? { id: null, version: 0, deleted_at: null, date, complete: null, steps: null, sleep: null, fast: false }), steps, steps_source, sleep, updated_at: stamp(now()) };
      noteRef.current = n;
      setNote(n);
      enqueue(() => patchDayNote(db, date, stepsChanged ? { steps, steps_source, sleep } : { sleep }, n.updated_at));
      notify('Saved');
      return true;
    },
    [db, date, now, enqueue, notify],
  );

  /**
   * Saves a food to my foods (core's `saveMyFood`: newest first, capped; a plain save replaces the same name among foods with no barcode, a scanned
   * food replaces only the same product); foods pushed out are tombstoned.
   */
  const saveMine = useCallback(
    (food: UserFoodFields & { barcode?: string | null }) => {
      const t = stamp(now());
      const cur = mineRef.current;
      // Core decides which saved food this save replaces (a barcode: the same product; none: the same name among foods with no barcode) and
      // what the list looks like after it (never dropping a food with another barcode); the record keeps the replaced food's id and version.
      const same = myFoodReplaced(cur, { ...food } as UserFood);
      const rec: UserFood = { ...food, id: same?.id ?? newId(), version: same?.version ?? 0, updated_at: t, deleted_at: null };
      const next = saveMyFood(cur, rec);
      const dropped = cur.filter((f) => f.id !== rec.id && !next.includes(f)).map((f) => ({ ...f, deleted_at: t, updated_at: t }));
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

  const ready = loaded === date;
  return { date, ready, failed, logs, note, mine, mineFacts: mine.map(userFoodFacts), add, remove, copyPrevious, setComplete, setFast, saveStepsSleep, saveMine };
}
