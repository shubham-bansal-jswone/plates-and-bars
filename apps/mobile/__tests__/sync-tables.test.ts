/** @jest-environment node */
import { MIGRATIONS, migrate, type MigrationDb } from '../src/db/migrations';
import { SYNC_TABLES, applyPulled, clearPushed, isQueued, pendingChanges, pendingCount } from '../src/db/outbox';
import type { WorkoutDb } from '../src/db/workouts';

// node:sqlite ships with Node 22+; no @types/node here, so describe the few methods used.
interface Raw {
  exec(sql: string): void;
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Raw };

// A real SQLite (node:sqlite) behind the app's db interfaces, so triggers and backfill run for real.
function open(): MigrationDb & WorkoutDb & { raw: Raw } {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    execAsync: async (sql) => void raw.exec(sql),
    getFirstAsync: async <T,>(sql: string, ...p: (string | number)[]) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllAsync: async <T,>(sql: string, ...p: (string | number)[]) => raw.prepare(sql).all(...p) as T[],
    runAsync: async (sql, ...p) => raw.prepare(sql).run(...p),
  };
}

/** Applies migrations 1..n only, as an install at that version would have. */
async function installAt(db: MigrationDb, n: number) {
  await db.execAsync('CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL);');
  for (let v = 0; v < n; v++) {
    await db.execAsync(MIGRATIONS[v] as string);
    await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', v + 1);
  }
}

const clearKey = (db: ReturnType<typeof open>, t: keyof typeof SYNC_TABLES, k: string) => void db.raw.prepare('DELETE FROM sync_outbox WHERE tbl = ? AND key = ?').run(t, k);

const tableNames = (db: ReturnType<typeof open>) =>
  (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);

describe('sync tables migration (v6)', () => {
  it('fresh install creates every contract table and an empty outbox', async () => {
    const db = open();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    const names = tableNames(db);
    for (const local of Object.values(SYNC_TABLES)) expect(names).toContain(local);
    expect(Object.keys(SYNC_TABLES)).toHaveLength(16);
    expect(await pendingCount(db)).toBe(0);
  });

  it('is append-only and only adds objects (v7 adds the content store after it)', () => {
    expect(MIGRATIONS).toHaveLength(7);
    expect(MIGRATIONS[5]).not.toMatch(/DROP|DELETE|ALTER/i);
    expect(MIGRATIONS[6]).not.toMatch(/DROP|DELETE|ALTER|sync_outbox/i);
  });

  it('upgrade from v5 keeps every row and queues rows made before sign-in', async () => {
    const db = open();
    await installAt(db, 5);
    db.raw.exec(`
      INSERT INTO profiles (key, data) VALUES ('me', '{"a":1}');
      INSERT INTO consents (key, data) VALUES ('c1', '{}');
      INSERT INTO food_logs (key, log_date, data) VALUES ('f1', '2026-10-08', '{"x":1}'), ('f2', '2026-10-08', '{"deleted_at":"t"}');
      INSERT INTO day_notes (key, data) VALUES ('2026-10-08', '{}');
      INSERT INTO workouts (key, data) VALUES ('2026-10-08', '{}');
      INSERT INTO workout_sets (key, workout_date, kind, done, deleted, data) VALUES ('s1', '2026-10-08', 'work', 1, 0, '{}');
      INSERT INTO lift_stats (key, data) VALUES ('Squat', '{}');
      INSERT INTO user_foods (key, data) VALUES ('u1', '{}');
      INSERT INTO user_settings (key, data) VALUES ('me', '{}');
      INSERT INTO settings (key, value) VALUES ('flag', '1');
    `);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM food_logs').get()).toEqual({ n: 2 });
    expect(db.raw.prepare("SELECT data FROM profiles WHERE key = 'me'").get()).toEqual({ data: '{"a":1}' });
    expect(db.raw.prepare("SELECT value FROM settings WHERE key = 'flag'").get()).toEqual({ value: '1' });
    const queued = (await pendingChanges(db)).map((e) => `${e.tbl}:${e.key}`).sort();
    expect(queued).toEqual(
      ['profiles:me', 'consents:c1', 'food_logs:f1', 'food_logs:f2', 'day_notes:2026-10-08', 'workouts:2026-10-08',
        'workout_sets:s1', 'lift_stats:Squat', 'user_foods:u1', 'settings:me'].sort(),
    );
    // The v1 device-local flags are not synced.
    expect(queued.some((q) => q.startsWith('settings:flag'))).toBe(false);
  });

  it('upgrade from v1 applies every later migration', async () => {
    const db = open();
    await installAt(db, 1);
    db.raw.exec("INSERT INTO settings (key, value) VALUES ('flag', '1')");
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(db.raw.prepare("SELECT value FROM settings WHERE key = 'flag'").get()).toEqual({ value: '1' });
  });
});

describe('outbox change tracking', () => {
  const key = (e: { tbl: string; key: string }) => `${e.tbl}:${e.key}`;

  it('queues an insert and an update into every one of the 16 tables, with INSERT OR REPLACE too', async () => {
    const db = open();
    await migrate(db);
    for (const [contract, local] of Object.entries(SYNC_TABLES)) {
      const cols = local === 'workout_sets' ? "(key, workout_date, kind, done, data) VALUES ('k', 'd', 'work', 0, '{}')"
        : /^(food_logs|water_logs)$/.test(local) ? "(key, log_date, data) VALUES ('k', 'd', '{}')"
        : "(key, data) VALUES ('k', '{}')";
      db.raw.exec(`INSERT OR REPLACE INTO ${local} ${cols}`);
      expect((await pendingChanges(db)).map(key)).toContain(`${contract}:k`);
      await clearKey(db, contract as keyof typeof SYNC_TABLES, 'k');
      db.raw.exec(`INSERT OR REPLACE INTO ${local} ${cols}`);
      expect((await pendingChanges(db)).map(key)).toContain(`${contract}:k`);
      await clearKey(db, contract as keyof typeof SYNC_TABLES, 'k');
      db.raw.exec(`UPDATE ${local} SET data = '{"n":1}' WHERE key = 'k'`);
      expect((await pendingChanges(db)).map(key)).toContain(`${contract}:k`);
      await clearKey(db, contract as keyof typeof SYNC_TABLES, 'k');
    }
    expect(await pendingCount(db)).toBe(0);
  });

  it('keeps one entry per record and a tombstone write queues like any edit', async () => {
    const db = open();
    await migrate(db);
    db.raw.exec("INSERT INTO weights (key, data) VALUES ('2026-10-08', '{}')");
    db.raw.exec(`INSERT OR REPLACE INTO weights (key, data) VALUES ('2026-10-08', '{"deleted_at":"t"}')`);
    expect(await pendingCount(db)).toBe(1);
  });

  it('does not clear an entry edited after it was read for push', async () => {
    const db = open();
    await migrate(db);
    db.raw.exec("INSERT INTO swaps (key, data) VALUES ('Squat', '{}')");
    const [sent] = await pendingChanges(db);
    db.raw.exec(`UPDATE swaps SET data = '{"to":"Leg Press"}' WHERE key = 'Squat'`);
    await clearPushed(db, sent!);
    expect(await pendingCount(db)).toBe(1);
    const [again] = await pendingChanges(db);
    await clearPushed(db, again!);
    expect(await pendingCount(db)).toBe(0);
  });

  it('orders by edit and honours the limit', async () => {
    const db = open();
    await migrate(db);
    for (const k of ['a', 'b', 'c']) db.raw.exec(`INSERT INTO recipes (key, data) VALUES ('${k}', '{}')`);
    expect((await pendingChanges(db, 2)).map((e) => e.key)).toEqual(['a', 'b']);
  });

  describe('applyPulled', () => {
    const pullDb = (db: ReturnType<typeof open>, beforeClear?: () => void) => ({
      withExclusiveTransactionAsync: async (task: (txn: WorkoutDb) => Promise<void>) => {
        await task({
          ...db,
          runAsync: async (sql: string, ...p: (string | number)[]) => {
            if (sql.startsWith('DELETE FROM sync_outbox')) beforeClear?.();
            return db.runAsync(sql, ...p);
          },
        });
      },
    });
    const write = (db: ReturnType<typeof open>) => async () => void db.raw.exec("INSERT OR REPLACE INTO weights (key, data) VALUES ('2026-10-08', '{\"weight_kg\":70}')");

    it('writes the pulled row without leaving it queued', async () => {
      const db = open();
      await migrate(db);
      await applyPulled(pullDb(db), 'weights', '2026-10-08', write(db));
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM weights').get()).toEqual({ n: 1 });
      expect(await pendingCount(db)).toBe(0);
    });

    it('keeps a local edit made between the write and the clear queued', async () => {
      const db = open();
      await migrate(db);
      await applyPulled(
        pullDb(db, () => db.raw.exec(`UPDATE weights SET data = '{"weight_kg":71}' WHERE key = '2026-10-08'`)),
        'weights',
        '2026-10-08',
        write(db),
      );
      expect(await isQueued(db, 'weights', '2026-10-08')).toBe(true);
    });

    it('isQueued is false for an untouched record', async () => {
      const db = open();
      await migrate(db);
      expect(await isQueued(db, 'weights', 'x')).toBe(false);
    });
  });
});
