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
  it('creates the version table and applies every migration in order on a fresh database', async () => {
    const { db, log } = fakeDb(null);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(log.some((l) => l.includes('schema_version (version INTEGER'))).toBe(true);
    MIGRATIONS.forEach((m, i) => {
      expect(log).toContain(m);
      expect(log).toContain(`INSERT INTO schema_version (version) VALUES (?) ${i + 1}`);
    });
    expect(log.indexOf(MIGRATIONS[0] as string)).toBeLessThan(log.indexOf(MIGRATIONS[1] as string));
  });

  it('v2 creates the profiles and consents tables', () => {
    expect(MIGRATIONS[1]).toContain('CREATE TABLE IF NOT EXISTS profiles');
    expect(MIGRATIONS[1]).toContain('CREATE TABLE IF NOT EXISTS consents');
  });

  it('v3 creates the workouts, workout_sets and lift_stats tables', () => {
    for (const t of ['workouts', 'workout_sets', 'lift_stats']) expect(MIGRATIONS[2]).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
  });

  it('upgrades a version-1 database by applying v2 and v3 only', async () => {
    const { db, log } = fakeDb(1);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(log).not.toContain(MIGRATIONS[0]);
    expect(log).toContain(MIGRATIONS[1]);
    expect(log).toContain(MIGRATIONS[2]);
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
