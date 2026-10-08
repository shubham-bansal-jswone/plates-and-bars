package app.plateandbar.api.auth;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

    public record User(String id, String email, Instant createdAt) {}

    private final JdbcTemplate jdbc;

    public UserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<User> findById(String id) {
        return jdbc.query("SELECT id, email, created_at FROM users WHERE id = ?", UserRepository::map, id).stream()
                .findFirst();
    }

    public Optional<User> findByIdentity(String provider, String subject) {
        return jdbc
                .query(
                        "SELECT u.id, u.email, u.created_at FROM users u JOIN auth_identities i ON i.user_id = u.id"
                                + " WHERE i.provider = ? AND i.provider_subject = ?",
                        UserRepository::map,
                        provider,
                        subject)
                .stream()
                .findFirst();
    }

    public Optional<User> findByEmail(String normalisedEmail) {
        return jdbc.query("SELECT id, email, created_at FROM users WHERE email = ?", UserRepository::map, normalisedEmail)
                .stream()
                .findFirst();
    }

    public User create(String normalisedEmail, Instant now) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
                id,
                normalisedEmail,
                Db.utc(now),
                Db.utc(now));
        return new User(id, normalisedEmail, now);
    }

    public void linkIdentity(String userId, String provider, String subject, Instant now) {
        jdbc.update(
                "INSERT INTO auth_identities (id, user_id, provider, provider_subject, created_at) VALUES (?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(),
                userId,
                provider,
                subject,
                Db.utc(now));
    }

    private static User map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new User(
                rs.getString("id"),
                rs.getString("email"),
                Db.instant(rs.getObject("created_at", java.time.LocalDateTime.class)));
    }
}
