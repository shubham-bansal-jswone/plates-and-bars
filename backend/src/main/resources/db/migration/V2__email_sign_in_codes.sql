-- One-time email sign-in codes (ADR 003). One row per address: requesting a new code replaces the
-- previous one. The code is stored only as an HMAC digest; attempts counts wrong guesses (max 5).
-- Timestamps are UTC and always set by the application.
CREATE TABLE email_sign_in_codes (
    email      VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'trimmed, lower-cased',
    code_hash  CHAR(64)     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    attempts   INT          NOT NULL DEFAULT 0,
    expires_at DATETIME(3)  NOT NULL,
    used_at    DATETIME(3)  NULL,
    created_at DATETIME(3)  NOT NULL,
    PRIMARY KEY (email),
    KEY ix_email_sign_in_codes_expires (expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
