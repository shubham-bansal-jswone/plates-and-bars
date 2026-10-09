import { SYNC_TABLES, type SyncTableName } from '../db/outbox';
import type { WorkoutDb } from '../db/workouts';
import { buildRecord, type Doc } from '../sync/records';
import { getUserId } from '../sync/store';

/** Id source for records exported before any account exists: all-zero namespace, so ids still have the contract's shape. */
const NO_USER = '00000000-0000-0000-0000-000000000000';

export interface LocalExport {
  format_version: 1;
  exported_at: string;
  /** Where this came from; the server export (`GET /me/export`) has `user` and `conflict_log` instead. */
  source: 'device';
  /** The account this store is bound to, or null when no one ever signed in. */
  user_id: string | null;
  /** One array for every contract sync table, always present, rows in the contract's record shape (tombstones included). */
  tables: Record<SyncTableName, Doc[]>;
  /** Data that never leaves the device. TODO(#251): the progress-photo vault is added here once it exists. */
  device_only: Record<string, never>;
}

/** Every local table as contract records plus the food-log CSV of the prototype. Reads only; never needs the network. */
export async function buildLocalExport(db: WorkoutDb, now: Date = new Date()): Promise<{ file: LocalExport; csv: string }> {
  const userId = await getUserId(db);
  const exportedAt = now.toISOString();
  const tables = {} as Record<SyncTableName, Doc[]>;
  for (const tbl of Object.keys(SYNC_TABLES) as SyncTableName[]) {
    const rows = await db.getAllAsync<{ key: string; data: string }>(`SELECT key, data FROM ${SYNC_TABLES[tbl]} ORDER BY key`);
    const out: Doc[] = [];
    for (const r of rows) {
      const updated = (JSON.parse(r.data) as { updated_at?: string }).updated_at ?? exportedAt;
      const rec = await buildRecord(db, userId ?? NO_USER, { tbl, key: r.key, seq: 0, queued_at: updated });
      if (rec) out.push(rec);
    }
    tables[tbl] = out;
  }
  const file: LocalExport = { format_version: 1, exported_at: exportedAt, source: 'device', user_id: userId, tables, device_only: {} };
  return { file, csv: foodCsv(tables.food_logs) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** A spreadsheet cell: quoted, and a leading = + - @ is neutralised so a food name cannot run as a formula. */
const cell = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;

/** Prototype `exportData` CSV: one row per logged food, numbers for the quantity eaten. */
export function foodCsv(logs: Doc[]): string {
  const live = logs.filter((l) => !l.deleted_at).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rows = live.map((l) => {
    const q = Number(l.qty);
    return [l.date, l.meal, cell(String(l.name)), q, Math.round(Number(l.kcal) * q), r1(Number(l.protein_g) * q), r1(Number(l.carbs_g) * q), r1(Number(l.fat_g) * q)].join(',');
  });
  return ['date,meal,food,servings,kcal,protein_g,carbs_g,fat_g', ...rows].join('\n');
}
