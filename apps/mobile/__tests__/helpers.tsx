import type { ReactNode } from 'react';
import { ProfileProvider } from '../src/state/ProfileProvider';
import type { StoreDb } from '../src/db/records';

/** In-memory stand-in for the two statements the record store uses; rows keyed by table and key. */
export function memoryDb(): StoreDb & { rows: Map<string, string>; failWrites: boolean } {
  const rows = new Map<string, string>();
  const db = {
    rows,
    failWrites: false,
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
      const table = /INTO (\w+)/.exec(sql)![1];
      rows.set(`${table}:${p[0]}`, String(p[1]));
    },
  };
  return db;
}

export const withProfile = (db: StoreDb, ui: ReactNode) => <ProfileProvider db={db}>{ui}</ProfileProvider>;
