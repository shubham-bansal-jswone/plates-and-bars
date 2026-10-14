package app.plateandbar.api.auth;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RefreshTokenRepository {

    public record Row(String id, String userId, String familyId, Instant expiresAt, Instant rotatedAt, Instant revokedAt, Instant replacedAt) {}

    private final JdbcTemplate jdbc;

    public RefreshTokenRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** {@code replacesId} is the token this one was issued in exchange for, or null for a sign-in. */
    public void insert(
            String userId, String familyId, String tokenHash, Instant expiresAt, Instant now, String replacesId) {
        jdbc.update(
                "INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at, replaces_id)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(),
                userId,
                familyId,
                tokenHash,
                Db.utc(expiresAt),
                Db.utc(now),
                replacesId);
    }

    /** Tokens issued in exchange for {@code id}, locked. More than one only after lost-response retries. */
    public List<Row> findReplacementsForUpdate(String id) {
        return jdbc.query(
                "SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at, replaced_at FROM refresh_tokens"
                        + " WHERE replaces_id = ? FOR UPDATE",
                (rs, i) -> new Row(
                        rs.getString("id"),
                        rs.getString("user_id"),
                        rs.getString("family_id"),
                        Db.instant(rs.getObject("expires_at", java.time.LocalDateTime.class)),
                        Db.instant(rs.getObject("rotated_at", java.time.LocalDateTime.class)),
                        Db.instant(rs.getObject("revoked_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("replaced_at", java.time.LocalDateTime.class))),
                id);
    }

    /** Marks a never-presented token as replaced by a lost-response retry: presenting it later is reuse. */
    public void markReplaced(String id, Instant now) {
        jdbc.update("UPDATE refresh_tokens SET replaced_at = ? WHERE id = ? AND replaced_at IS NULL", Db.utc(now), id);
    }

    /** Locks the row so concurrent refreshes of one token are serialised. */
    public Optional<Row> findByHashForUpdate(String tokenHash) {
        return jdbc
                .query(
                        "SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at, replaced_at FROM refresh_tokens"
                                + " WHERE token_hash = ? FOR UPDATE",
                        (rs, i) -> new Row(
                                rs.getString("id"),
                                rs.getString("user_id"),
                                rs.getString("family_id"),
                                Db.instant(rs.getObject("expires_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("rotated_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("revoked_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("replaced_at", java.time.LocalDateTime.class))),
                        tokenHash)
                .stream()
                .findFirst();
    }

    public void markRotated(String id, Instant now) {
        jdbc.update("UPDATE refresh_tokens SET rotated_at = ? WHERE id = ?", Db.utc(now), id);
    }

    public void revokeFamily(String familyId, Instant now) {
        jdbc.update(
                "UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
                Db.utc(now),
                familyId);
    }
}
