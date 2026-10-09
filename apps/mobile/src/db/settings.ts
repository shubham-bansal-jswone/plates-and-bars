import { validMealPlan } from '../meals/validPlan';
import type { Settings } from '../settings/types';
import type { StoreDb } from './records';

// One Settings record per install, under the local key 'me'; its id stays null until #31 (see `Settings.id`).
const KEY = 'me';

export async function loadSettings(db: StoreDb): Promise<Settings | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM user_settings WHERE key = ?', KEY);
  if (!row) return null;
  const s = JSON.parse(row.data) as Settings;
  // meal_plan has its shape owned by core: a malformed one reads as none.
  // Contract 0.1.3: flex entries carry a plan id. Drop any stored without one rather than crash on it.
  return { ...s, flex: (s.flex ?? []).filter((f) => typeof f?.id === 'string' && f.id !== ''), meal_plan: validMealPlan(s.meal_plan) };
}

export async function saveSettings(db: StoreDb, s: Settings): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO user_settings (key, data) VALUES (?, ?)', KEY, JSON.stringify(s));
}
