-- Wrong email codes per address, kept across codes so that requesting a new code does not reset the cap
-- (issue #43). One row per wrong guess against a live code; rows older than the longest window are pruned
-- by the application. Timestamps are UTC and set by the application.
CREATE TABLE email_verify_failures (
    id        BIGINT      NOT NULL AUTO_INCREMENT,
    email     VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'trimmed, lower-cased',
    failed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY ix_email_verify_failures_email_time (email, failed_at),
    KEY ix_email_verify_failures_time (failed_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
