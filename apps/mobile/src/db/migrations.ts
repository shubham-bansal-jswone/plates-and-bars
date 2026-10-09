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
  // v2: the user's Profile and Consent records, each a contract-shaped JSON document under a fixed local key
  `CREATE TABLE IF NOT EXISTS profiles (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS consents (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );`,
  // v3: training records. workouts (contract Workout) and workout_sets (contract WorkoutSet) are JSON documents;
  // lift_stats holds core's own lift record per exercise, mapped to the contract at sync time (#135). workouts and
  // lift_stats are natural-key tables (key = date, key = exercise); workout_sets are keyed by their random id and carry plain columns
  // for the local joins (workout date, kind, done, deleted), since their contract workout_id is not known until #31.
  `CREATE TABLE IF NOT EXISTS workouts (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS workout_sets (
     key TEXT PRIMARY KEY NOT NULL,
     workout_date TEXT NOT NULL,
     kind TEXT NOT NULL,
     done INTEGER NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS workout_sets_by_date ON workout_sets (workout_date);
   CREATE TABLE IF NOT EXISTS lift_stats (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );`,
  // v4: the user's contract Settings record, one row under the fixed local key 'me' (a JSON document). The v1
  // table named settings is the device-local key/value flags, so this one is user_settings.
  `CREATE TABLE IF NOT EXISTS user_settings (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );`,
  // v5: food records. food_logs (contract FoodLog) and user_foods (contract UserFood) are JSON documents keyed by their
  // random id; food_logs carry their day for the per-day load. day_notes (contract DayNote) is a natural-key table, key = date.
  // Deleted logs stay as tombstones (deleted_at in the document) so sync can push the delete.
  `CREATE TABLE IF NOT EXISTS food_logs (
     key TEXT PRIMARY KEY NOT NULL,
     log_date TEXT NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS food_logs_by_date ON food_logs (log_date);
   CREATE TABLE IF NOT EXISTS day_notes (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS user_foods (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );`,
  // v6: the remaining contract tables (water_logs, weights, measurements, recipes, kitchen_tests, exclusions, swaps; JSON
  // documents under `key`, natural-key tables keyed by date or source exercise) plus change tracking for all 16 sync
  // tables: sync_outbox holds one row per (contract table name, key) changed since its last push. Triggers on every
  // synced table fill it on any INSERT/UPDATE, so writers (including INSERT OR REPLACE) need no outbox code and later
  // table-writing PRs do not touch this file. Rows created before sign-in are backfilled into the outbox here.
  `CREATE TABLE IF NOT EXISTS water_logs (
     key TEXT PRIMARY KEY NOT NULL,
     log_date TEXT NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS water_logs_by_date ON water_logs (log_date);
   CREATE TABLE IF NOT EXISTS weights (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS measurements (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS recipes (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS kitchen_tests (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS exclusions (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS swaps (
     key TEXT PRIMARY KEY NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sync_outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     tbl TEXT NOT NULL,
     key TEXT NOT NULL,
     queued_at TEXT NOT NULL,
     UNIQUE (tbl, key)
   );
   CREATE TRIGGER IF NOT EXISTS profiles_outbox_i AFTER INSERT ON profiles
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('profiles', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS profiles_outbox_u AFTER UPDATE ON profiles
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('profiles', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS consents_outbox_i AFTER INSERT ON consents
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('consents', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS consents_outbox_u AFTER UPDATE ON consents
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('consents', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS food_logs_outbox_i AFTER INSERT ON food_logs
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('food_logs', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS food_logs_outbox_u AFTER UPDATE ON food_logs
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('food_logs', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS water_logs_outbox_i AFTER INSERT ON water_logs
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('water_logs', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS water_logs_outbox_u AFTER UPDATE ON water_logs
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('water_logs', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS day_notes_outbox_i AFTER INSERT ON day_notes
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('day_notes', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS day_notes_outbox_u AFTER UPDATE ON day_notes
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('day_notes', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS workouts_outbox_i AFTER INSERT ON workouts
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('workouts', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS workouts_outbox_u AFTER UPDATE ON workouts
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('workouts', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS workout_sets_outbox_i AFTER INSERT ON workout_sets
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('workout_sets', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS workout_sets_outbox_u AFTER UPDATE ON workout_sets
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('workout_sets', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS lift_stats_outbox_i AFTER INSERT ON lift_stats
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('lift_stats', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS lift_stats_outbox_u AFTER UPDATE ON lift_stats
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('lift_stats', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS weights_outbox_i AFTER INSERT ON weights
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('weights', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS weights_outbox_u AFTER UPDATE ON weights
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('weights', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS measurements_outbox_i AFTER INSERT ON measurements
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('measurements', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS measurements_outbox_u AFTER UPDATE ON measurements
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('measurements', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS user_foods_outbox_i AFTER INSERT ON user_foods
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('user_foods', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS user_foods_outbox_u AFTER UPDATE ON user_foods
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('user_foods', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS recipes_outbox_i AFTER INSERT ON recipes
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('recipes', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS recipes_outbox_u AFTER UPDATE ON recipes
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('recipes', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS kitchen_tests_outbox_i AFTER INSERT ON kitchen_tests
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('kitchen_tests', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS kitchen_tests_outbox_u AFTER UPDATE ON kitchen_tests
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('kitchen_tests', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS exclusions_outbox_i AFTER INSERT ON exclusions
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('exclusions', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS exclusions_outbox_u AFTER UPDATE ON exclusions
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('exclusions', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS swaps_outbox_i AFTER INSERT ON swaps
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('swaps', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS swaps_outbox_u AFTER UPDATE ON swaps
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('swaps', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS user_settings_outbox_i AFTER INSERT ON user_settings
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('settings', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   CREATE TRIGGER IF NOT EXISTS user_settings_outbox_u AFTER UPDATE ON user_settings
   BEGIN
     INSERT OR REPLACE INTO sync_outbox (tbl, key, queued_at) VALUES ('settings', NEW.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
   END;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'profiles', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM profiles;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'consents', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM consents;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'food_logs', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM food_logs;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'day_notes', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM day_notes;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'workouts', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM workouts;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'workout_sets', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM workout_sets;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'lift_stats', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM lift_stats;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'user_foods', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM user_foods;
   INSERT OR IGNORE INTO sync_outbox (tbl, key, queued_at) SELECT 'settings', key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM user_settings;`,
];

export async function migrate(db: MigrationDb): Promise<number> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);');
  const row = await db.getFirstAsync<{ version: number }>('SELECT MAX(version) AS version FROM schema_version');
  const current = row?.version ?? 0;
  // Database written by a newer app: never downgrade, report the real stored version.
  if (current > MIGRATIONS.length) return current;
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
