package app.plateandbar.api.account;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** SQL for account rights. Every statement is scoped by the user id from the token. */
@Repository
class AccountRepository {

    record Account(String id, String email, Instant createdAt) {}

    private final JdbcTemplate jdbc;

    AccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Optional<Account> find(String userId) {
        return jdbc
                .query(
                        "SELECT id, email, created_at FROM users WHERE id = ?",
                        (rs, n) -> new Account(
                                rs.getString("id"),
                                rs.getString("email"),
                                rs.getObject("created_at", java.time.LocalDateTime.class)
                                        .toInstant(java.time.ZoneOffset.UTC)),
                        userId)
                .stream()
                .findFirst();
    }

    /**
     * Removes the user. Every user-owned table (synced tables, sync_state, sync_conflicts, auth_identities,
     * refresh_tokens) references users with ON DELETE CASCADE, so one statement removes them all and a table
     * added later with the same foreign key is covered. Tables keyed by email address have no foreign key
     * and are cleared here. Must run in one transaction.
     */
    void deleteAll(String userId) {
        Set<String> emails = new LinkedHashSet<>(jdbc.queryForList(
                "SELECT email FROM users WHERE id = ? AND email IS NOT NULL", String.class, userId));
        emails.addAll(jdbc.queryForList(
                "SELECT provider_subject FROM auth_identities WHERE user_id = ? AND provider = 'email'",
                String.class,
                userId));
        for (String email : emails) {
            jdbc.update("DELETE FROM email_sign_in_codes WHERE email = ?", email);
            jdbc.update("DELETE FROM email_verify_failures WHERE email = ?", email);
        }
        jdbc.update("DELETE FROM users WHERE id = ?", userId);
    }
}
