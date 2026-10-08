import type { Settings } from '../settings/types';
import type { StoreDb } from './records';

// One Settings record per install, under the local key 'me'; its id stays null until #31 (see `Settings.id`).
const KEY = 'me';

export async function loadSettings(db: StoreDb): Promise<Settings | null> {
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM user_settings WHERE key = ?', KEY);
  return row ? (JSON.parse(row.data) as Settings) : null;
}

export async function saveSettings(db: StoreDb, s: Settings): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO user_settings (key, data) VALUES (?, ?)', KEY, JSON.stringify(s));
}
