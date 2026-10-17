-- Per-account record cap (#349, contract 0.1.16, POST /sync 413 account_full). `records` is the number of rows the user
-- stores across the 16 synced tables, tombstones included (the conflict log is not counted). SyncService keeps it in step
-- inside the sync transaction, under the FOR UPDATE lock on this row, so a push is checked against one number instead of
-- sixteen COUNT(*) queries. A row is added only when a push stores a new id; rows are never removed (deletes are soft),
-- and the whole account goes with DELETE /me (this row cascades from users).
--
-- Backfill: every user with records has a sync_state row, because a record is only ever written after the sync
-- transaction created it.
ALTER TABLE sync_state
    ADD COLUMN records BIGINT NOT NULL DEFAULT 0 COMMENT 'rows stored for this user across the 16 sync tables, tombstones included';

UPDATE sync_state s SET s.records =
    (SELECT COUNT(*) FROM profiles WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM consents WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM food_logs WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM water_logs WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM day_notes WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM workouts WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM workout_sets WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM lift_stats WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM weights WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM measurements WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM user_foods WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM recipes WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM kitchen_tests WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM exclusions WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM swaps WHERE user_id = s.user_id) +
    (SELECT COUNT(*) FROM settings WHERE user_id = s.user_id);
