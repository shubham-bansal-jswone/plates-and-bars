import type { ReactNode } from 'react';
import { ProfileProvider } from '../src/state/ProfileProvider';
import { SettingsProvider } from '../src/state/SettingsProvider';
import type { StoreDb } from '../src/db/records';
import type { WorkoutDb } from '../src/db/workouts';

/** In-memory stand-in for the two statements the record store uses; rows keyed by table and key. */
export function memoryDb(): WorkoutDb & { rows: Map<string, string>; sets: Map<string, { date: string; kind: string; done: number; deleted: number; data: string }>; failWrites: boolean; lag?: (sql: string) => number } {
  const rows = new Map<string, string>();
  const sets = new Map<string, { date: string; kind: string; done: number; deleted: number; data: string }>();
  const db = {
    rows,
    sets,
    failWrites: false,
    lag: undefined as undefined | ((sql: string) => number),
    async getAllAsync<T>(sql: string, ...p: (string | number)[]) {
      if (sql.includes('FROM workout_sets WHERE workout_date')) return [...sets.values()].filter((s) => s.date === p[0]).map((s) => ({ data: s.data })) as T[];
      if (sql.includes('GROUP BY workout_date')) {
        const n = new Map<string, number>();
        for (const s of sets.values()) if (s.kind === 'work' && s.done === 1 && s.deleted === 0) n.set(s.date, (n.get(s.date) ?? 0) + 1);
        return [...n].map(([workout_date, c]) => ({ workout_date, n: c })) as T[];
      }
      if (sql.includes('FROM water_logs WHERE log_date')) return [...rows].filter(([k, d]) => k.startsWith('water_logs:') && (JSON.parse(d) as { date: string }).date === p[0]).map(([, data]) => ({ data })) as T[];
      if (sql.includes('FROM food_logs WHERE log_date')) return [...rows].filter(([k, d]) => k.startsWith('food_logs:') && (JSON.parse(d) as { date: string }).date === p[0]).map(([, data]) => ({ data })) as T[];
      const table = /FROM (\w+)/.exec(sql)![1];
      return [...rows].filter(([k]) => k.startsWith(`${table}:`)).map(([k, data]) => ({ key: k.slice(table!.length + 1), data })) as T[];
    },
    async getFirstAsync<T>(sql: string, ...p: (string | number)[]) {
      const table = /FROM (\w+)/.exec(sql)![1];
      if (sql.includes('WHERE key')) {
        const data = rows.get(`${table}:${p[0]}`);
        return (data === undefined ? null : { data }) as T | null;
      }
      // latest by given_at, as the consents query orders
      const all = [...rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => v);
      all.sort((a, b) => (JSON.parse(b).given_at as string).localeCompare(JSON.parse(a).given_at));
      return (all[0] === undefined ? null : { data: all[0] }) as T | null;
    },
    async runAsync(sql: string, ...p: (string | number)[]) {
      if (db.failWrites) throw new Error('disk full');
      const lag = db.lag;
      if (lag) await new Promise((r) => setTimeout(r, lag(sql)));
      const table = /INTO (\w+)/.exec(sql)![1];
      if (table === 'workout_sets') {
        sets.set(String(p[0]), { date: String(p[1]), kind: String(p[2]), done: Number(p[3]), deleted: Number(p[4]), data: String(p[5]) });
        return;
      }
      rows.set(`${table}:${p[0]}`, String(p[table === 'food_logs' || table === 'water_logs' ? 2 : 1]));
    },
  };
  return db;
}

export const withProfile = (db: StoreDb, ui: ReactNode) => <ProfileProvider db={db}>
    <SettingsProvider db={db}>{ui}</SettingsProvider>
  </ProfileProvider>;
