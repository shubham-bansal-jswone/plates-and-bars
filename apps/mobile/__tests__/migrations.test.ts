import { MIGRATIONS, migrate, type MigrationDb } from '../src/db/migrations';

function fakeDb(startVersion: number | null, failOn?: string) {
  const log: string[] = [];
  const db: MigrationDb = {
    execAsync: async (sql) => {
      log.push(sql);
      if (failOn && sql === failOn) throw new Error('boom');
    },
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

  it('rolls back and records no version when a migration fails', async () => {
    const { db, log } = fakeDb(null, MIGRATIONS[0]);
    await expect(migrate(db)).rejects.toThrow('boom');
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('COMMIT');
    expect(log.some((l) => l.startsWith('INSERT INTO schema_version'))).toBe(false);
  });

  it('returns the stored version when the database is newer than the app', async () => {
    const { db, log } = fakeDb(MIGRATIONS.length + 3);
    expect(await migrate(db)).toBe(MIGRATIONS.length + 3);
    expect(log).not.toContain(MIGRATIONS[0]);
  });
});
