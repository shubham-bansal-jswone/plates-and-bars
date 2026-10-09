import { useCallback, useEffect, useRef, useState } from 'react';
import { num, saveBuiltFood, type RecipeFoodResult, type UserFoodFields } from '@plate-and-bar/core';
import { trackWrite } from '../db/pendingWrites';
import { loadRecipes, saveRecipe } from '../db/recipes';
import { loadUserFoods, saveLog, saveUserFood } from '../db/food';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import type { FoodLog, Meal, UserFood } from '../food/types';
import { localDate } from '../setup/logic';
import { LOAD_FAILED, SAVE_FAILED } from './copy';
import type { Recipe } from './types';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

type Saved = Extract<RecipeFoodResult, { kind: 'ok' }>;

/** What the builder hands over besides core's result. */
export interface RecipeSave {
  result: Saved;
  yield_mode: Recipe['yield_mode'];
  katoris: string;
  cooked_g: string;
  oil: string;
  /** The saved recipe being edited, if any. */
  editing: Recipe | null;
  /** Add to the day's log after saving. */
  log: { meal: Meal; qty: number } | null;
}

/**
 * Saved recipes. A save shows at once and its writes (the recipe, my foods, the log) go through one FIFO queue.
 * My foods are shared with the Food screen, so they are read again inside the queue and merged with core's
 * `saveBuiltFood` at write time; foods pushed out of the 80 or renamed away are tombstoned, never deleted.
 */
export function useRecipes({ db, now, notify }: { db: WorkoutDb; now: () => Date; notify: (msg: string) => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    loadRecipes(db).then(
      (r) => {
        if (!live) return;
        setRecipes(r);
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

  const save = useCallback(
    (s: RecipeSave) => {
      const t = stamp(now());
      queue.current = queue.current
        .then(async () => {
          const { result: r, editing } = s;
          const current = await loadRecipes(db);
          const old = editing ? current.find((x) => x.id === editing.id) : current.find((x) => x.name === r.name);
          const rec: Recipe = {
            id: old?.id ?? newId(),
            version: old?.version ?? 0,
            updated_at: t,
            deleted_at: null,
            name: r.name,
            ingredients: r.ingredients.map((i) => ({ ingredient: i.ingredient, amount: num(i.amount), unit: i.unit })),
            yield_mode: s.yield_mode,
            katoris: s.yield_mode === 'katori' ? num(s.katoris) : null,
            cooked_g: s.yield_mode === 'grams' ? num(s.cooked_g) : null,
            oil: s.oil,
          };
          await saveRecipe(db, rec);
          const food = await saveFood(db, r.food, t, editing?.name);
          if (s.log) {
            const log: FoodLog = {
              id: newId(),
              version: 0,
              updated_at: t,
              deleted_at: null,
              date: localDate(now()),
              meal: s.log.meal,
              name: food.name,
              qty: s.log.qty,
              kcal: food.kcal,
              protein_g: food.protein_g,
              carbs_g: food.carbs_g,
              fat_g: food.fat_g,
              food_id: food.id,
            };
            await saveLog(db, log);
          }
          setRecipes(await loadRecipes(db));
        })
        .catch(() => notify(SAVE_FAILED));
      trackWrite(queue.current);
    },
    [db, now, notify],
  );

  /** Resolves when every queued write has finished (the Food screen reads again after this). */
  const idle = useCallback(() => queue.current, []);

  return { ready, failed, recipes, save, idle };
}

/** Puts `fields` first in my foods (merged with what is stored now) and tombstones the foods that drop out. Returns the saved food. */
export async function saveFood(db: WorkoutDb, fields: UserFoodFields, t: string, replacedName?: string): Promise<UserFood> {
  const mine = await loadUserFoods(db);
  const same = mine.find((f) => f.name === fields.name);
  const rec: UserFood = { ...fields, id: same?.id ?? newId(), version: same?.version ?? 0, updated_at: t, deleted_at: null };
  const next = saveBuiltFood(mine, rec, replacedName);
  await saveUserFood(db, rec);
  for (const f of mine) if (f.name !== fields.name && !next.includes(f)) await saveUserFood(db, { ...f, deleted_at: t, updated_at: t });
  return rec;
}
