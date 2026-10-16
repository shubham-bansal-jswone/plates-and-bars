-- AI quota counter (#232, contract 0.1.6). One row per user, UTC day and feature. Holds only counts: never
-- the text sent or received. The daily quota is the sum of `calls` over a user's rows for the day; the
-- monthly budget cap is the sum of the token columns for the month. Deleted with the account (cascade).
-- Not part of GET /me/export (a counter, like rate-limit state).
CREATE TABLE ai_usage (
    user_id       CHAR(36)    NOT NULL,
    day           DATE        NOT NULL COMMENT 'UTC calendar day',
    feature       VARCHAR(20) NOT NULL COMMENT 'describe_meal, ask_why or weekly_summary',
    calls         INT         NOT NULL DEFAULT 0 COMMENT 'reserved or completed calls; released on failure',
    input_tokens  BIGINT      NOT NULL DEFAULT 0,
    output_tokens BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, feature),
    KEY ix_ai_usage_day (day),
    CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
