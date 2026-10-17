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
        // The anonymised ledger the budget cap reads. No user id: it outlives the account.
        jdbc.update(
                "INSERT INTO ai_spend_monthly (month, tokens) VALUES (?, ?) ON DUPLICATE KEY UPDATE tokens = tokens + ?",
                day.withDayOfMonth(1), Math.max(0, (long) in) + Math.max(0, (long) out),
                Math.max(0, (long) in) + Math.max(0, (long) out));
    }

    /**
     * Input plus output tokens billed in the months from {@code from} (inclusive) to {@code to} (exclusive), from the
     * anonymised ledger, so deleting an account does not give its spend back.
     */
    long tokensBetween(LocalDate from, LocalDate to) {
        Long n = jdbc.queryForObject(
                "SELECT COALESCE(SUM(tokens), 0) FROM ai_spend_monthly WHERE month >= ? AND month < ?",
                Long.class, from, to);
        return n == null ? 0 : n;
    }

    /**
     * Marks the month's 80% alert as fired if the ledger has reached 80% of the budget and it has not fired yet. One
     * conditional UPDATE, so of any number of concurrent callers exactly one gets true, and the flag survives a
     * restart. The threshold is {@code budget - budget / 5}, which cannot overflow for any positive budget (a
     * multiplication would wrap for budgets near {@code Long.MAX_VALUE} and fire a false alert).
     */
    boolean markAlertSent(LocalDate month, long budgetTokens) {
        return jdbc.update(
                "UPDATE ai_spend_monthly SET alert_sent = 1 WHERE month = ? AND alert_sent = 0 AND tokens >= ?",
                month, budgetTokens - budgetTokens / 5) == 1;
    }
}
