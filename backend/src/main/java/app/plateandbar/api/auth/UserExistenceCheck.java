package app.plateandbar.api.auth;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Uncached primary-key lookup on {@code users}, run for every authenticated request so an access token
 * issued before its account was deleted is refused. User ids are never reused, so no denylist is needed.
 */
@Component
public class UserExistenceCheck {

    private final JdbcTemplate jdbc;

    public UserExistenceCheck(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean exists(String userId) {
        return !jdbc.queryForList("SELECT 1 FROM users WHERE id = ?", Integer.class, userId).isEmpty();
    }
}
