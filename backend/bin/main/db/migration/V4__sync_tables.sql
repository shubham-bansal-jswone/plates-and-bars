-- Sync (#28, ADR 001, contract POST /sync). Timestamps are UTC, DATETIME(3), set by the application.
--
-- One table per SyncTable, all with the same shape. The meta fields of the contract (id, version,
-- updated_at, deleted_at) are columns; every other field of the record is stored as JSON in `data`,
-- validated against the contract schema before it is written. Record ids use utf8mb4_bin so they never
-- fold case (user_id keeps the collation of users.id, which a foreign key requires; it always comes from
-- the token and is a canonical lower-case UUID). Primary key (user_id, id): the same id under two users is two unrelated rows, so
-- a user can never reach another's record by guessing its id. `seq` is the per-user change counter
-- (see sync_state) that the opaque cursor encodes.

-- Bookkeeping: one row per user, locked for the length of a sync so concurrent syncs of one user run
-- one after another and seq values are assigned in commit order. Not a record table, so it has no
-- version or deleted_at.
CREATE TABLE sync_state (
    user_id    CHAR(36)    NOT NULL,
    seq        BIGINT      NOT NULL DEFAULT 0 COMMENT 'last change number handed out to this user',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_sync_state_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE profiles (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_profiles_user_seq (user_id, seq),
    CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE consents (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_consents_user_seq (user_id, seq),
    CONSTRAINT fk_consents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE food_logs (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_food_logs_user_seq (user_id, seq),
    CONSTRAINT fk_food_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE water_logs (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_water_logs_user_seq (user_id, seq),
    CONSTRAINT fk_water_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE day_notes (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_day_notes_user_seq (user_id, seq),
    CONSTRAINT fk_day_notes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE workouts (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_workouts_user_seq (user_id, seq),
    CONSTRAINT fk_workouts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE workout_sets (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_workout_sets_user_seq (user_id, seq),
    CONSTRAINT fk_workout_sets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE lift_stats (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_lift_stats_user_seq (user_id, seq),
    CONSTRAINT fk_lift_stats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE weights (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_weights_user_seq (user_id, seq),
    CONSTRAINT fk_weights_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE measurements (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_measurements_user_seq (user_id, seq),
    CONSTRAINT fk_measurements_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE user_foods (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_user_foods_user_seq (user_id, seq),
    CONSTRAINT fk_user_foods_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE recipes (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_recipes_user_seq (user_id, seq),
    CONSTRAINT fk_recipes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE kitchen_tests (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_kitchen_tests_user_seq (user_id, seq),
    CONSTRAINT fk_kitchen_tests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE exclusions (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_exclusions_user_seq (user_id, seq),
    CONSTRAINT fk_exclusions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE swaps (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_swaps_user_seq (user_id, seq),
    CONSTRAINT fk_swaps_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE settings (
    user_id    CHAR(36)    NOT NULL,
    id         CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    version    INT         NOT NULL COMMENT 'server version, 1 on first write',
    updated_at DATETIME(3) NOT NULL COMMENT 'device edit time (clamped); decides conflicts',
    deleted_at DATETIME(3) NULL COMMENT 'tombstone',
    seq        BIGINT      NOT NULL COMMENT 'sync_state.seq at the last write',
    data       JSON        NOT NULL COMMENT 'record fields other than id, version, updated_at, deleted_at',
    PRIMARY KEY (user_id, id),
    KEY ix_settings_user_seq (user_id, seq),
    CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- The losing copy of every real conflict (not idempotent retries). version, updated_at and
-- deleted_at are those of the losing copy; `record` holds its other fields.
CREATE TABLE sync_conflicts (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    user_id         CHAR(36)    NOT NULL,
    table_name      VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    record_id       CHAR(36)    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    loser           VARCHAR(8)  NOT NULL COMMENT 'client | server',
    version         INT         NOT NULL COMMENT 'version of the losing copy (for the client, the version it sent)',
    winner_version  INT         NOT NULL COMMENT 'version stored after resolution',
    updated_at      DATETIME(3) NOT NULL,
    deleted_at      DATETIME(3) NULL,
    record          JSON        NOT NULL,
    logged_at       DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY ix_sync_conflicts_user_record (user_id, table_name, record_id),
    CONSTRAINT fk_sync_conflicts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
