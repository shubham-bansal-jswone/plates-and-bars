/** The subset of expo-sqlite's database the migrator needs (lets tests use a fake). */
export interface MigrationDb {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}

/** Ordered migrations; index + 1 is the schema version. Never edit one that has shipped. */
export const MIGRATIONS: readonly string[] = [
  // v1: key/value settings, used for device-local flags
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
];

export async function migrate(db: MigrationDb): Promise<number> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);');
  const row = await db.getFirstAsync<{ version: number }>('SELECT MAX(version) AS version FROM schema_version');
  const current = row?.version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.execAsync('BEGIN');
    try {
      await db.execAsync(MIGRATIONS[v] as string);
      await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', v + 1);
      await db.execAsync('COMMIT');
    } catch (e) {
      await db.execAsync('ROLLBACK');
      throw e;
    }
  }
  return MIGRATIONS.length;
}

export const DB_NAME = 'plate-and-bar.db';
