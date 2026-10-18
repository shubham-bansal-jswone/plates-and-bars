package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.MutableClock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.mysql.MySQLContainer;

/** Quota, kill switch and budget cap on real MySQL, with the flags that the tests need switched on. */
@AutoConfigureTestRestTemplate
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.ai.describe-meal-enabled=true",
            "app.ai.ask-why-enabled=true",
            "app.ai.monthly-budget-tokens=1000",
            "app.ai.daily-limit=10"
        })
@Import(AiITBase.Config.class)
class AiQuotaIT extends AiITBase {

    @org.springframework.test.context.bean.override.mockito.MockitoBean AiProvider provider; // not the stub: the stub keeps everything off
    @Autowired AiQuotaService quotas;
    @Autowired AiUsageRepository usageRepo;

    @BeforeEach
    void resetClock() {
        clock.advance(Duration.between(clock.instant(), START));
        jdbc.update("DELETE FROM ai_usage");
        jdbc.update("DELETE FROM ai_spend_monthly");
    }

    @Test
    void flagOffOrNoBudgetMeansOff() {
        assertThat(quotas.isOn(AiFeature.DESCRIBE_MEAL)).isTrue();
        assertThat(quotas.isOn(AiFeature.WEEKLY_SUMMARY)).isFalse(); // its flag is not set
        assertThatThrownBy(() -> quotas.requireOn(AiFeature.WEEKLY_SUMMARY))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status().value()).isEqualTo(503);
                    assertThat(e.code()).isEqualTo("feature_disabled");
                });
    }

    @Test
    void reachingTheMonthlyBudgetTurnsEverythingOffUntilTheMonthEnds() {
        String u = newUser();
        jdbc.update("INSERT INTO ai_spend_monthly (month, tokens) VALUES ('2026-10-01', 1000)");
        assertThat(quotas.isOn(AiFeature.ASK_WHY)).isFalse();
        assertThat(quotas.isOn(AiFeature.DESCRIBE_MEAL)).isFalse();
        clock.advance(Duration.ofDays(24)); // 2026-11-01
        assertThat(quotas.isOn(AiFeature.ASK_WHY)).isTrue();
    }

    @Test
    void reservesUpToTheLimitThenRefusesWithRetryAfterAndQuotaBody() {
        String u = newUser();
        for (int i = 1; i <= 10; i++) {
            AiQuota q = quotas.reserve(u, AiFeature.values()[i % 3]).quota(); // shared across features
            assertThat(q.limit()).isEqualTo(10);
            assertThat(q.remaining()).isEqualTo(10 - i);
            assertThat(q.resetsAt()).isEqualTo(Instant.parse("2026-10-09T00:00:00Z"));
        }
        assertThatThrownBy(() -> quotas.reserve(u, AiFeature.ASK_WHY))
                .isInstanceOfSatisfying(QuotaExceededException.class, e -> {
                    assertThat(e.code()).isEqualTo("quota_exceeded");
                    assertThat(e.quota().remaining()).isZero();
                    assertThat(e.retryAfterSeconds()).isEqualTo(12 * 3600);
                });
        assertThat(calls(u)).isEqualTo(10);
        assertThat(quotas.quota(u).remaining()).isZero();
    }

    @Test
    void releaseGivesTheUnitBackAndNeverGoesBelowZero() {
        String u = newUser();
        var r = quotas.reserve(u, AiFeature.ASK_WHY);
        assertThat(quotas.quota(u).remaining()).isEqualTo(9);
        quotas.release(r);
        quotas.release(r);
        assertThat(quotas.quota(u).remaining()).isEqualTo(10);
        assertThat(calls(u)).isZero();
    }

    @Test
    void theDayIsUtcAndCountResetsAtMidnightZ() {
        String u = newUser();
        clock.advance(Duration.ofHours(11).plusMinutes(59).plusSeconds(59)); // 23:59:59Z
        for (int i = 0; i < 10; i++) {
            quotas.reserve(u, AiFeature.DESCRIBE_MEAL);
        }
        assertThatThrownBy(() -> quotas.reserve(u, AiFeature.DESCRIBE_MEAL)).isInstanceOf(QuotaExceededException.class);
        clock.advance(Duration.ofSeconds(1)); // 00:00:00Z
        assertThat(quotas.quota(u).remaining()).isEqualTo(10);
        assertThat(quotas.reserve(u, AiFeature.DESCRIBE_MEAL).quota().remaining()).isEqualTo(9);
    }

    @Test
    void concurrentReservationsCannotOverrunTheLimit() throws Exception {
        String u = newUser();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < 24; i++) {
                results.add(pool.submit(() -> {
                    go.await();
                    try {
                        quotas.reserve(u, AiFeature.DESCRIBE_MEAL);
                        return true;
                    } catch (QuotaExceededException e) {
                        return false;
                    }
                }));
            }
            go.countDown();
            int granted = 0;
            for (Future<Boolean> f : results) {
                if (f.get()) {
                    granted++;
                }
            }
            assertThat(granted).isEqualTo(10);
            assertThat(calls(u)).isEqualTo(10);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void oneUsersUsageNeverTouchesAnothers() {
        String a = newUser();
        String b = newUser();
        for (int i = 0; i < 10; i++) {
            quotas.reserve(a, AiFeature.ASK_WHY);
        }
        assertThat(quotas.quota(b).remaining()).isEqualTo(10);
        assertThat(quotas.reserve(b, AiFeature.ASK_WHY).quota().remaining()).isEqualTo(9);
        quotas.release(quotas.reserve(b, AiFeature.ASK_WHY));
        assertThat(calls(a)).isEqualTo(10);
        assertThat(calls(b)).isEqualTo(1);
    }

    @Test
    void aVanishedUserIs401NotAForeignKeyError() {
        assertThatThrownBy(() -> quotas.reserve(UUID.randomUUID().toString(), AiFeature.ASK_WHY))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(401));
    }

    @Test
    void usageIsDeletedWithTheUser() {
        String a = newUser();
        quotas.reserve(a, AiFeature.ASK_WHY);
        jdbc.update("DELETE FROM users WHERE id = ?", a);
        assertThat(calls(a)).isZero();
    }

    @Test
    void statusOverHttpReportsFlagsAndQuota() {
        String u = newUser();
        quotas.reserve(u, AiFeature.ASK_WHY);
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(jwt.issue(u).value());
        var res = http.exchange("/api/v1/ai/status", HttpMethod.GET, new HttpEntity<>(h), String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody())
                .contains("\"describe_meal\":true", "\"ask_why\":true", "\"weekly_summary\":false")
                .contains("\"limit\":10", "\"remaining\":9", "\"resets_at\":\"2026-10-09T00:00:00Z\"");
    }

    @Test
    void budgetMonthIsUtcAndStatusReadsItOnce() {
        String u = newUser();
        jdbc.update("INSERT INTO ai_spend_monthly (month, tokens) VALUES ('2026-10-01', 1000)");
        clock.advance(Duration.ofDays(23).plusHours(11)); // 2026-10-31T23:00Z: still October in UTC
        assertThat(quotas.features().values()).containsOnly(false).hasSize(AiFeature.values().length);
        assertThat(quotas.features().get(AiFeature.ASK_WHY)).isFalse();
        clock.advance(Duration.ofHours(1)); // November 1 00:00Z
        assertThat(quotas.features().get(AiFeature.ASK_WHY)).isTrue();
    }

    @Test
    void spendSurvivesDeletingTheAccountThatMadeIt() {
        String u = newUser();
        var held = quotas.reserve(u, AiFeature.ASK_WHY);
        quotas.recordTokens(held, 700, 300); // the whole budget of 1000
        assertThat(quotas.isOn(AiFeature.ASK_WHY)).isFalse();

        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(jwt.issue(u).value());
        assertThat(http.exchange("/api/v1/me", HttpMethod.DELETE, new HttpEntity<>(h), String.class)
                .getStatusCode().value()).isEqualTo(204);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_usage WHERE user_id = ?", Integer.class, u)).isZero();
        assertThat(quotas.isOn(AiFeature.ASK_WHY)).as("the deleted account's tokens still count").isFalse();
        // A new account gets a fresh daily quota but not a fresh budget.
        assertThat(quotas.features().values()).containsOnly(false);
    }

    @Test
    void theLedgerHoldsNoUserIdAndAddsUpPerMonth() {
        var held = quotas.reserve(newUser(), AiFeature.ASK_WHY);
        quotas.recordTokens(held, 10, 5);
        quotas.recordTokens(held, 1, 1);
        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.columns"
                + " WHERE table_schema = DATABASE() AND table_name = 'ai_spend_monthly'", String.class))
                .containsExactlyInAnyOrder("month", "tokens", "alert_sent");
        assertThat(jdbc.queryForObject("SELECT tokens FROM ai_spend_monthly WHERE month = '2026-10-01'", Long.class))
                .isEqualTo(17L);
    }

    @Test
    void v6BackfillSumsExistingUsagePerUtcMonthAcrossUsers() throws Exception {
        String a = newUser();
        String b = newUser();
        jdbc.update("INSERT INTO ai_usage (user_id, day, feature, calls, input_tokens, output_tokens) VALUES"
                + " (?, '2026-09-30', 'ask_why', 1, 10, 5), (?, '2026-09-30', 'ask_why', 1, 1, 1),"
                + " (?, '2026-10-01', 'ask_why', 1, 100, 50), (?, '2026-10-31', 'describe_meal', 1, 200, 100),"
                + " (?, '2026-10-31', 'ask_why', 1, 7, 3)", a, b, a, a, b);
        jdbc.update("DELETE FROM ai_spend_monthly");
        String sql = new String(new org.springframework.core.io.ClassPathResource("db/migration/V6__ai_spend_monthly.sql")
                .getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        jdbc.update(sql.substring(sql.indexOf("INSERT INTO ai_spend_monthly")).trim().replaceAll(";\\s*$", ""));
        assertThat(jdbc.queryForObject("SELECT tokens FROM ai_spend_monthly WHERE month = '2026-09-01'", Long.class))
                .isEqualTo(17L);
        assertThat(jdbc.queryForObject("SELECT tokens FROM ai_spend_monthly WHERE month = '2026-10-01'", Long.class))
                .isEqualTo(460L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_spend_monthly", Integer.class)).isEqualTo(2);
    }

    private List<String> captureWarns(Runnable body) {
        ch.qos.logback.classic.Logger lg = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(AiQuotaService.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> app = new ch.qos.logback.core.read.ListAppender<>();
        app.start();
        lg.addAppender(app);
        try {
            body.run();
        } finally {
            lg.detachAppender(app);
        }
        return app.list.stream().filter(e -> e.getLevel() == ch.qos.logback.classic.Level.WARN)
                .map(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage).toList();
    }

    @Test
    void crossingEightyPercentLogsOneWarnPerMonthAndSurvivesARestart() {
        String u = newUser();
        var r = quotas.reserve(u, AiFeature.ASK_WHY);
        List<String> warns = captureWarns(() -> {
            quotas.recordTokens(r, 300, 400); // 700: under
            quotas.recordTokens(r, 50, 50); // 800: exactly 80%
            quotas.recordTokens(r, 10, 10); // still over, no second WARN
        });
        assertThat(warns).hasSize(1);
        assertThat(warns.get(0)).contains("80%", "2026-10-01").doesNotContain(u);
        assertThat(jdbc.queryForObject("SELECT alert_sent FROM ai_spend_monthly WHERE month = '2026-10-01'", Integer.class)).isEqualTo(1);
        // the flag is in the database, so the same condition after a restart stays quiet
        assertThat(captureWarns(() -> quotas.recordTokens(r, 1, 1))).isEmpty();
        // next month it fires again
        clock.advance(Duration.ofDays(24));
        var r2 = quotas.reserve(u, AiFeature.ASK_WHY);
        assertThat(captureWarns(() -> quotas.recordTokens(r2, 450, 450))).hasSize(1);
    }

    @Test
    void aVeryLargeBudgetNeverFiresAFalseAlert() {
        java.time.LocalDate month = java.time.LocalDate.of(2026, 10, 1);
        jdbc.update("INSERT INTO ai_spend_monthly (month, tokens) VALUES (?, 5)", month);
        // budget * 80 would wrap negative here and make every row look over the line
        assertThat(usageRepo.markAlertSent(month, Long.MAX_VALUE)).isFalse();
        assertThat(usageRepo.markAlertSent(month, Long.MAX_VALUE / 10 * 9)).isFalse();
        assertThat(jdbc.queryForObject("SELECT alert_sent FROM ai_spend_monthly WHERE month = ?", Integer.class, month)).isZero();
        // 5 of 7 is below the threshold (7 - 1 = 6), so it stays quiet
        assertThat(usageRepo.markAlertSent(month, 7)).isFalse();
        // fires at the first whole token at or above 80% (ceil(4.8) = 5)
        assertThat(usageRepo.markAlertSent(month, 6)).isTrue(); // threshold 6 - 1 = 5
    }

    @Test
    void belowEightyPercentLogsNothing() {
        String u = newUser();
        var r = quotas.reserve(u, AiFeature.ASK_WHY);
        assertThat(captureWarns(() -> quotas.recordTokens(r, 399, 400))).isEmpty();
    }

    @Test
    void twoConcurrentRequestsCrossingTheThresholdLogOneWarn() throws Exception {
        String a = newUser();
        String b = newUser();
        var ra = quotas.reserve(a, AiFeature.ASK_WHY);
        var rb = quotas.reserve(b, AiFeature.ASK_WHY);
        jdbc.update("INSERT INTO ai_spend_monthly (month, tokens) VALUES ('2026-10-01', 700)");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<String> warns = captureWarns(() -> {
                CountDownLatch go = new CountDownLatch(1);
                List<Future<?>> fs = List.of(
                        pool.submit(() -> { go.await(); quotas.recordTokens(ra, 60, 60); return null; }),
                        pool.submit(() -> { go.await(); quotas.recordTokens(rb, 60, 60); return null; }));
                go.countDown();
                for (Future<?> f : fs) {
                    try {
                        f.get();
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                }
            });
            assertThat(warns).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
    }
}
