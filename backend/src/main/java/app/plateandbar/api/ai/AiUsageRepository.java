package app.plateandbar.api.ai;

import java.time.LocalDate;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** SQL for ai_usage. Every statement is scoped by the user id from the token. Counts only, never content. */
@Repository
class AiUsageRepository {

    private final JdbcTemplate jdbc;

    AiUsageRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Locks the user's row so concurrent reservations of one user run one after another; empty if no such user. */
    Optional<String> lockUser(String userId) {
        return jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR UPDATE", String.class, userId).stream()
                .findFirst();
    }

    int callsOn(String userId, LocalDate day) {
        Integer n = jdbc.queryForObject(
                "SELECT COALESCE(SUM(calls), 0) FROM ai_usage WHERE user_id = ? AND day = ?",
                Integer.class, userId, day);
        return n == null ? 0 : n;
    }

    void addCall(String userId, LocalDate day, AiFeature feature) {
        jdbc.update(
                "INSERT INTO ai_usage (user_id, day, feature, calls) VALUES (?, ?, ?, 1)"
                        + " ON DUPLICATE KEY UPDATE calls = calls + 1",
                userId, day, feature.key());
    }

    void removeCall(String userId, LocalDate day, AiFeature feature) {
        jdbc.update(
                "UPDATE ai_usage SET calls = calls - 1 WHERE user_id = ? AND day = ? AND feature = ? AND calls > 0",
                userId, day, feature.key());
    }

    void addTokens(String userId, LocalDate day, AiFeature feature, int in, int out) {
        jdbc.update(
                "UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?"
                        + " WHERE user_id = ? AND day = ? AND feature = ?",
                Math.max(0, in), Math.max(0, out), userId, day, feature.key());
    }

    /** Input plus output tokens recorded by every user from {@code from} (inclusive) to {@code to} (exclusive). */
    long tokensBetween(LocalDate from, LocalDate to) {
        Long n = jdbc.queryForObject(
                "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM ai_usage WHERE day >= ? AND day < ?",
                Long.class, from, to);
        return n == null ? 0 : n;
    }
}
