import { useCallback, useEffect, useRef, useState } from 'react';
import { num, userFoodFacts, type KitchenCompareFood, type UserFoodFields } from '@plate-and-bar/core';
import { trackWrite } from '../db/pendingWrites';
import { loadUserFoods } from '../db/food';
import { loadKitchenTests, saveKitchenTest } from '../db/kitchenTests';
import type { WorkoutDb } from '../db/workouts';
import { withPhotosSettled } from '../sync/guard';
import { deleteKitchenPhoto, putKitchenPhoto } from '../photos/vault';
import type { PullDb } from '../db/outbox';
import { saveFood } from '../recipes/useRecipes';
import type { UserFood } from '../food/types';
import type { Ingredient } from '../recipes/types';
import { LOAD_FAILED, PHOTO_SAVE_FAILED, SAVE_FAILED } from './copy';
import type { KitchenTest, ServingName } from './types';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** A personal food as the comparison reads it: through core's `userFoodFacts`, so a blank unit reads "1 serving" as in the prototype's `allFoods()`. */
const compareFood = (f: UserFood): KitchenCompareFood => {
  const u = userFoodFacts(f);
  return { name: u.name, unit: u.serving.label, kcal: u.per_serving.kcal };
};
/** The database as one that can run an owed vault wipe first (as in usePhotos); one that cannot fails the photo write, never the test. */
function wipeable(db: WorkoutDb): WorkoutDb & PullDb {
  if (typeof (db as Partial<PullDb>).withExclusiveTransactionAsync !== 'function') throw new Error('no transactions');
  return db as WorkoutDb & PullDb;
}
const weight = (s: string): number | null => (s.trim() === '' ? null : num(s));

/** The test as typed: weights stay text until core reads them. */
export interface TestFields {
  id: string;
  name: string;
  date: string;
  note: string;
  rows: { ingredient: string; amount: string; unit: string }[];
  pot: string;
  potFull: string;
  cooked: string;
  serving: string;
  sname: ServingName;
  /** A serving photo picked in this editor (base64 JPEG), written to the vault on save. Never part of the record. */
  photo?: string | null;
}

/**
 * Kitchen tests. A save or delete shows at once and its writes go through one FIFO queue. "Save and use for my
 * logging" also puts the food in my foods, merged with what is stored at write time (see `saveFood`). A delete
 * is a tombstone, and leaves the food a test already made.
 */
export function useKitchenTests({ db, now, notify }: { db: WorkoutDb; now: () => Date; notify: (msg: string) => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tests, setTests] = useState<KitchenTest[]>([]);
  // My foods, for "the app's current value" next to a weighed dish; a read that fails leaves the comparison out.
  const [mine, setMine] = useState<KitchenCompareFood[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    loadUserFoods(db).then(
      (f) => live && setMine(f.map(compareFood)),
      () => undefined,
    );
    loadKitchenTests(db).then(
      (t) => {
        if (!live) return;
        setTests(t);
        setReady(true);
      },
      () => {
        if (!live) return;
        setFailed(true);
        notify(LOAD_FAILED);
      },
    );
    return () => {
      live = false;
    };
  }, [db, notify]);

  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      queue.current = queue.current
        .then(async () => {
          await write();
          setTests(await loadKitchenTests(db));
          setMine((await loadUserFoods(db)).map(compareFood));
        })
        .catch(() => notify(SAVE_FAILED));
      trackWrite(queue.current);
    },
    [db, notify],
  );

  /** `name` is core's trimmed name; `food` is set for "Save and use for my logging". */
  const save = useCallback(
    (f: TestFields, name: string, food: UserFoodFields | null) => {
      const t = stamp(now());
      enqueue(async () => {
        const old = (await loadKitchenTests(db)).find((x) => x.id === f.id);
        // The photo stays on the device (vault); only the flag syncs. A failed write leaves the test saved without it.
        let has_photo = old?.has_photo ?? false;
        if (f.photo) {
          try {
            await withPhotosSettled(wipeable(db), () => putKitchenPhoto(f.id, f.photo as string));
            has_photo = true;
          } catch {
            notify(PHOTO_SAVE_FAILED);
          }
        }
        // TODO: core's kitchenTest could return the kept rows (amount above 0) so this filter is not repeated here.
        const ingredients: Ingredient[] = f.rows.filter((r) => num(r.amount) > 0).map((r) => ({ ingredient: r.ingredient, amount: num(r.amount), unit: r.unit }));
        await saveKitchenTest(db, {
          id: f.id,
          version: old?.version ?? 0,
          updated_at: t,
          deleted_at: null,
          name,
          date: f.date,
          note: f.note,
          ingredients,
          pot_g: weight(f.pot),
          pot_full_g: weight(f.potFull),
          cooked_g: weight(f.cooked),
          serving_g: weight(f.serving),
          serving_name: f.sname,
          has_photo,
        });
        if (food) await saveFood(db, food, t);
      });
    },
    [db, now, enqueue, notify],
  );

  const remove = useCallback(
    (id: string) => {
      const t = stamp(now());
      setTests((x) => x.filter((k) => k.id !== id));
      enqueue(async () => {
        const cur = (await loadKitchenTests(db)).find((x) => x.id === id);
        if (cur) await saveKitchenTest(db, { ...cur, deleted_at: t, updated_at: t });
        // The photo goes with the test; a failure here leaves an orphan file that the next wipe removes.
        if (cur?.has_photo) await withPhotosSettled(wipeable(db), () => deleteKitchenPhoto(id)).catch(() => undefined);
      });
    },
    [db, now, enqueue],
  );

  const idle = useCallback(() => queue.current, []);
  return { ready, failed, tests, mine, save, remove, idle };
}
