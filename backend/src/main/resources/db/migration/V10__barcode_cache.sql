-- Per-barcode cache for GET /foods/barcode/{code} (#944, ADR 009). Public product facts from Open Food Facts keyed by
-- barcode only: no user id, no account, so it is not personal data and is not touched by DELETE /me or GET /me/export.
-- Filled one barcode at a time, on demand. There is no list, search or export over it (ODbL, ADR 009). A row is
-- answered only while expires_at is in the future (a hit for 30 days, a miss for 24 hours) and is deleted once it is
-- past, so nothing is kept beyond its time to live.
CREATE TABLE barcode_cache (
    code       VARCHAR(13) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'digits of the request, 8, 12 or 13',
    found      TINYINT(1)  NOT NULL COMMENT '1 a product (payload), 0 Open Food Facts has none (payload NULL)',
    payload    JSON        NULL COMMENT 'the trimmed OffProduct answer, exactly as served',
    fetched_at DATETIME(3) NOT NULL COMMENT 'UTC',
    expires_at DATETIME(3) NOT NULL COMMENT 'UTC; fetched_at plus 30 days (found) or 24 hours (not found)',
    PRIMARY KEY (code),
    KEY ix_barcode_cache_expires (expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
