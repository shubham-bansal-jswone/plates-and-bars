-- Saved routines (#1184, ADR 011, contract 0.1.27): the 17th sync table, same shape as the other 16 (see V4).
-- One row per routine with a random UUIDv4 id; name, exercises and created_at are in `data`. Soft delete only.
-- No row exists before the first push, so sync_state.records needs no backfill. The 100-live-routine cap is checked
-- by SyncService inside the per-account transaction (it counts rows with deleted_at IS NULL for one user, a range
-- scan of the primary key prefix).
CREATE TABLE routines (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_routines_user_seq (user_id, seq),
    CONSTRAINT fk_routines_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
