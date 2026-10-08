import type { ReactNode } from 'react';
import { ProfileProvider } from '../src/state/ProfileProvider';
import type { StoreDb } from '../src/db/records';

/** In-memory stand-in for the two statements the record store uses; rows keyed by table and key. */
export function memoryDb(): StoreDb & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    async getFirstAsync<T>(sql: string, ...p: (string | number)[]) {
      const table = /FROM (\w+)/.exec(sql)![1];
      const data = rows.get(`${table}:${p[0]}`);
      return (data === undefined ? null : { data }) as T | null;
    },
    async runAsync(sql: string, ...p: (string | number)[]) {
      const table = /INTO (\w+)/.exec(sql)![1];
      rows.set(`${table}:${p[0]}`, String(p[1]));
    },
  };
}

export const withProfile = (db: StoreDb, ui: ReactNode) => <ProfileProvider db={db}>{ui}</ProfileProvider>;
