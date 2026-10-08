package app.plateandbar.api.auth;

import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Wrong email codes per address across all codes (V3). Rows are never reset by issuing a new code. */
@Repository
public class EmailVerifyFailureRepository {

    private final JdbcTemplate jdbc;

    public EmailVerifyFailureRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(String email, Instant now) {
        jdbc.update("INSERT INTO email_verify_failures (email, failed_at) VALUES (?, ?)", email, Db.utc(now));
    }

    /** The newest {@code limit} failures after {@code since}, newest first. */
    public List<Instant> newest(String email, Instant since, int limit) {
        return jdbc.query(
                "SELECT failed_at FROM email_verify_failures WHERE email = ? AND failed_at > ?"
                        + " ORDER BY failed_at DESC LIMIT ?",
                (rs, i) -> Db.instant(rs.getObject("failed_at", java.time.LocalDateTime.class)),
                email,
                Db.utc(since),
                limit);
    }

    public void deleteOlderThan(Instant before) {
        jdbc.update("DELETE FROM email_verify_failures WHERE failed_at < ?", Db.utc(before));
    }
}
