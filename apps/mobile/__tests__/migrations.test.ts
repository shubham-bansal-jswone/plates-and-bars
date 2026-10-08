import { MIGRATIONS, migrate, type MigrationDb } from '../src/db/migrations';

function fakeDb(startVersion: number | null) {
  const log: string[] = [];
  const db: MigrationDb = {
    execAsync: async (sql) => void log.push(sql),
    getFirstAsync: async <T,>() => ({ version: startVersion }) as T,
    runAsync: async (sql, ...p) => void log.push(`${sql} ${p.join(',')}`),
  };
  return { db, log };
}

describe('migrate', () => {
  it('creates the version table and applies migration 1 on a fresh database', async () => {
    const { db, log } = fakeDb(null);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(log.some((l) => l.includes('schema_version (version INTEGER'))).toBe(true);
    expect(log).toContain(MIGRATIONS[0]);
    expect(log).toContain('INSERT INTO schema_version (version) VALUES (?) 1');
  });

  it('does not re-apply migrations already recorded', async () => {
    const { db, log } = fakeDb(MIGRATIONS.length);
    await migrate(db);
    expect(log).not.toContain(MIGRATIONS[0]);
  });
});
