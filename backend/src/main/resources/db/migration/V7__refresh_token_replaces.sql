-- Lost-response grace for POST /auth/refresh (#399, ADR 003). A token issued by a rotation points at the token it
-- replaced, so a retry of the rotated token can tell whether the newer token was ever used. No token value is stored,
-- only the id of the earlier row.
ALTER TABLE refresh_tokens
    ADD COLUMN replaces_id CHAR(36) NULL COMMENT 'id of the refresh token this one was issued in exchange for',
    ADD KEY ix_refresh_tokens_replaces (replaces_id);
