package app.plateandbar.api.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RefreshTokenRepository {

    public record Row(String id, String userId, String familyId, Instant expiresAt, Instant rotatedAt, Instant revokedAt) {}

    private final JdbcTemplate jdbc;

    public RefreshTokenRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String userId, String familyId, String tokenHash, Instant expiresAt, Instant now) {
        jdbc.update(
                "INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(),
                userId,
                familyId,
                tokenHash,
                Db.utc(expiresAt),
                Db.utc(now));
    }

    /** Locks the row so concurrent refreshes of one token are serialised. */
    public Optional<Row> findByHashForUpdate(String tokenHash) {
        return jdbc
                .query(
                        "SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at FROM refresh_tokens"
                                + " WHERE token_hash = ? FOR UPDATE",
                        (rs, i) -> new Row(
                                rs.getString("id"),
                                rs.getString("user_id"),
                                rs.getString("family_id"),
                                Db.instant(rs.getObject("expires_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("rotated_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("revoked_at", java.time.LocalDateTime.class))),
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
