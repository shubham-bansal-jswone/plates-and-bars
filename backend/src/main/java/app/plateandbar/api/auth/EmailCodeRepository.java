package app.plateandbar.api.auth;

import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class EmailCodeRepository {

    public record Row(String codeHash, int attempts, Instant expiresAt, Instant usedAt) {}

    private final JdbcTemplate jdbc;

    public EmailCodeRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** One row per address: a new code replaces the previous one and resets the attempt counter. */
    public void replace(String email, String codeHash, Instant expiresAt, Instant now) {
        jdbc.update(
                "INSERT INTO email_sign_in_codes (email, code_hash, attempts, expires_at, used_at, created_at)"
                        + " VALUES (?, ?, 0, ?, NULL, ?) AS new"
                        + " ON DUPLICATE KEY UPDATE code_hash = new.code_hash, attempts = 0,"
                        + " expires_at = new.expires_at, used_at = NULL, created_at = new.created_at",
                email,
                codeHash,
                Db.utc(expiresAt),
                Db.utc(now));
    }

    public Optional<Row> findForUpdate(String email) {
        return jdbc
                .query(
                        "SELECT code_hash, attempts, expires_at, used_at FROM email_sign_in_codes"
                                + " WHERE email = ? FOR UPDATE",
                        (rs, i) -> new Row(
                                rs.getString("code_hash"),
                                rs.getInt("attempts"),
                                Db.instant(rs.getObject("expires_at", java.time.LocalDateTime.class)),
                                Db.instant(rs.getObject("used_at", java.time.LocalDateTime.class))),
                        email)
                .stream()
                .findFirst();
    }

    public void recordWrongAttempt(String email) {
        jdbc.update("UPDATE email_sign_in_codes SET attempts = attempts + 1 WHERE email = ?", email);
    }

    public void markUsed(String email, Instant now) {
        jdbc.update("UPDATE email_sign_in_codes SET used_at = ? WHERE email = ?", Db.utc(now), email);
    }

    public void deleteExpired(Instant before) {
        jdbc.update("DELETE FROM email_sign_in_codes WHERE expires_at < ?", Db.utc(before));
    }
}
