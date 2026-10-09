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
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;

/** Quota, kill switch and budget cap on real MySQL, with the flags that the tests need switched on. */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.ai.describe-meal-enabled=true",
            "app.ai.ask-why-enabled=true",
            "app.ai.monthly-budget-tokens=1000",
            "app.ai.daily-limit=10"
        })
@Import(AiQuotaIT.Config.class)
class AiQuotaIT {

    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4");

    static {
        MYSQL.start();
    }

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
    }

    static final Instant START = Instant.parse("2026-10-08T12:00:00Z");

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(START);
        }
    }

    @Autowired AiQuotaService quotas;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;
    @Autowired TestRestTemplate http;
    @Autowired JwtService jwt;

    @BeforeEach
    void resetClock() {
        clock.advance(Duration.between(clock.instant(), START));
        jdbc.update("DELETE FROM ai_usage");
    }

    String newUser() {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO users (id, email) VALUES (?, ?)", id, id + "@example.com");
        return id;
    }

    int calls(String user) {
        Integer n = jdbc.queryForObject("SELECT COALESCE(SUM(calls), 0) FROM ai_usage WHERE user_id = ?", Integer.class, user);
        return n == null ? 0 : n;
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
        jdbc.update("INSERT INTO ai_usage (user_id, day, feature, calls, input_tokens, output_tokens)"
                + " VALUES (?, '2026-10-01', 'ask_why', 1, 600, 400)", u);
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
}
