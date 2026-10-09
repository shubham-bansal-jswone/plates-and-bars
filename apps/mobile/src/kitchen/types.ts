import type { Ingredient } from '../recipes/types';
import type { SyncMeta } from '../setup/types';

export const SERVING_NAMES = ['katori', 'plate', 'piece', 'glass', 'bowl'] as const;
export type ServingName = (typeof SERVING_NAMES)[number];

/** Contract `KitchenTest`. Photos stay on the device; `has_photo` is the only part that syncs. */
export interface KitchenTest extends SyncMeta {
  name: string;
  date: string;
  note: string;
  ingredients: Ingredient[];
  pot_g: number | null;
  pot_full_g: number | null;
  cooked_g: number | null;
  serving_g: number | null;
  serving_name: ServingName;
  has_photo: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): boolean => x === null || isNum(x);

/** Shape check for a kitchen test read back from storage. */
export function isKitchenTest(x: unknown): x is KitchenTest {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    isNum(x.version) &&
    typeof x.updated_at === 'string' &&
    typeof x.name === 'string' &&
    typeof x.date === 'string' &&
    typeof x.note === 'string' &&
    Array.isArray(x.ingredients) &&
    x.ingredients.every((i) => isObj(i) && typeof i.ingredient === 'string' && isNum(i.amount) && typeof i.unit === 'string') &&
    isNumOrNull(x.pot_g) &&
    isNumOrNull(x.pot_full_g) &&
    isNumOrNull(x.cooked_g) &&
    isNumOrNull(x.serving_g) &&
    SERVING_NAMES.includes(x.serving_name as ServingName) &&
    typeof x.has_photo === 'boolean'
  );
}
