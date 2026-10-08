package app.plateandbar.api.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.auth.MailSender;
import app.plateandbar.api.support.MutableClock;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Per-address limits on real MySQL: the failed-code cap persists across new codes, code issuance is capped,
 * both recover with time, and nothing identifying reaches the logs. Default limits except the per-IP ones,
 * which are lifted here because every request comes from the same loopback address.
 */
@Testcontainers
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.rate-limit.max-tracked-keys=50",
            "app.rate-limit.public-per-ip.capacity=100000",
            "app.rate-limit.email-start-per-ip.capacity=100000",
            "app.rate-limit.email-verify-per-ip.capacity=100000",
            "app.rate-limit.authenticated-per-user.capacity=3"
        })
class RateLimitIT {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
    }

    static class CapturingMail implements MailSender {
        final AtomicReference<String> lastCode = new AtomicReference<>();
        final List<String> sentTo = new CopyOnWriteArrayList<>();

        @Override
        public void sendSignInCode(String email, String code, Instant expiresAt) {
            lastCode.set(code);
            sentTo.add(email);
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(Instant.parse("2026-10-08T06:30:00Z"));
        }

        @Bean
        @Primary
        CapturingMail capturingMail() {
            return new CapturingMail();
        }
    }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;
    @Autowired CapturingMail mail;
    @Autowired RateLimiter ipLimiter;

    private ListAppender<ILoggingEvent> logs;
    // TRACE for our code only; framework loggers stay at their defaults (Spring Security TRACE prints the peer address itself).
    private static final List<String> LOGGERS = List.of("app.plateandbar");

    @BeforeEach
    void captureLogs() {
        for (String n : LOGGERS) {
            ((Logger) LoggerFactory.getLogger(n)).setLevel(Level.TRACE);
        }
        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).detachAppender(logs);
        for (String n : LOGGERS) {
            ((Logger) LoggerFactory.getLogger(n)).setLevel(null);
        }
    }

    private static String uniq() {
        return "rl-" + java.util.UUID.randomUUID() + "@example.com";
    }

    private ResponseEntity<Map> start(String email) {
        return http.postForEntity("/api/v1/auth/email/start", Map.of("email", email), Map.class);
    }

    private ResponseEntity<Map> verify(String email, String code) {
        return http.postForEntity("/api/v1/auth/email/verify", Map.of("email", email, "code", code), Map.class);
    }

    private String wrongCode() {
        String right = mail.lastCode.get();
        return right.equals("000000") ? "000001" : "000000";
    }

    /** Requests a code and burns all 5 wrong attempts on it. */
    private void burnOneCode(String email) {
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        for (int i = 0; i < 5; i++) {
            assertThat(verify(email, wrongCode()).getStatusCode().value()).isEqualTo(401);
        }
    }

    private static void assertRateLimited(ResponseEntity<Map> res) {
        assertThat(res.getStatusCode().value()).isEqualTo(429);
        assertThat(res.getBody()).containsEntry("code", "rate_limited").containsKey("message");
        assertThat(Long.parseLong(res.getHeaders().getFirst("Retry-After"))).isPositive();
    }

    private int failureRows(String email) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM email_verify_failures WHERE email = ?", Integer.class, email);
    }

    @Test
    void issuingNewCodesDoesNotResetTheFailedAttemptCap() {
        String email = uniq();
        burnOneCode(email);
        burnOneCode(email);
        assertThat(failureRows(email)).isEqualTo(10);

        // A fresh code has its own 5 attempts, but the address already used its 10 for the hour.
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        assertThat(jdbc.queryForObject("SELECT attempts FROM email_sign_in_codes WHERE email = ?", Integer.class, email))
                .isZero();
        assertThat(failureRows(email)).isEqualTo(10);

        // Even the correct code is refused while the address is capped, and no account appears.
        ResponseEntity<Map> blocked = verify(email, mail.lastCode.get());
        assertRateLimited(blocked);
        assertThat(Long.parseLong(blocked.getHeaders().getFirst("Retry-After"))).isBetween(3000L, 3600L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, email)).isZero();
        // A blocked attempt is not a wrong guess and adds nothing.
        assertThat(failureRows(email)).isEqualTo(10);

        // Another address is unaffected.
        String other = uniq();
        assertThat(start(other).getStatusCode().value()).isEqualTo(202);
        assertThat(verify(other, mail.lastCode.get()).getStatusCode().value()).isEqualTo(200);

        // Once the hour has rolled over, a new code works.
        clock.advance(Duration.ofMinutes(61));
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        assertThat(verify(email, mail.lastCode.get()).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void ipKeyFloodCannotEvictAnAddressBucket() {
        String victim = uniq();
        for (int i = 0; i < 5; i++) {
            assertThat(start(victim).getStatusCode().value()).isEqualTo(202);
        }
        // Twice the IP limiter's maximum in distinct keys.
        for (int i = 0; i < 100; i++) {
            ipLimiter.consume("public-ip", "2001:db8:" + i + "::/64", new RateLimitProperties.Limit(5, Duration.ofHours(1)));
        }
        assertThat(ipLimiter.trackedKeys()).isLessThanOrEqualTo(50);
        assertRateLimited(start(victim));
    }

    @Test
    void parallelWrongGuessesCannotOvershootTheCap() throws Exception {
        String email = uniq();
        burnOneCode(email);
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        for (int i = 0; i < 4; i++) {
            assertThat(verify(email, wrongCode()).getStatusCode().value()).isEqualTo(401);
        }
        assertThat(failureRows(email)).isEqualTo(9);

        String wrong = wrongCode();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(8);
        java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        List<java.util.concurrent.Future<Integer>> results = new java.util.ArrayList<>();
        for (int i = 0; i < 8; i++) {
            results.add(pool.submit(() -> {
                go.await();
                return verify(email, wrong).getStatusCode().value();
            }));
        }
        go.countDown();
        int unauthorized = 0;
        int limited = 0;
        for (var f : results) {
            int code = f.get(60, java.util.concurrent.TimeUnit.SECONDS);
            if (code == 401) unauthorized++;
            if (code == 429) limited++;
        }
        pool.shutdown();
        assertThat(unauthorized).isEqualTo(1);
        assertThat(limited).isEqualTo(7);
        assertThat(failureRows(email)).isEqualTo(10);
    }

    @Test
    void dailyCapHoldsAfterTheHourlyWindowClears() {
        String email = uniq();
        burnOneCode(email);
        burnOneCode(email);
        clock.advance(Duration.ofMinutes(61));
        burnOneCode(email);
        burnOneCode(email);
        assertThat(failureRows(email)).isEqualTo(20);

        clock.advance(Duration.ofMinutes(61));
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        ResponseEntity<Map> blocked = verify(email, mail.lastCode.get());
        assertRateLimited(blocked);
        assertThat(Long.parseLong(blocked.getHeaders().getFirst("Retry-After"))).isGreaterThan(3600L);

        clock.advance(Duration.ofHours(23));
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        assertThat(verify(email, mail.lastCode.get()).getStatusCode().value()).isEqualTo(200);
        // Old rows are pruned the next time a code is issued.
        assertThat(failureRows(email)).isLessThan(20);
    }

    @Test
    void codeIssuanceIsCappedPerAddressAndRecovers() {
        String email = uniq();
        for (int i = 0; i < 5; i++) {
            assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        }
        assertRateLimited(start(email));
        assertRateLimited(start(email.toUpperCase()));
        assertThat(mail.sentTo.stream().filter(email::equals).count()).isEqualTo(5);
        // The refused request issued nothing: the stored code is still the 5th one.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM email_sign_in_codes WHERE email = ?", Integer.class, email))
                .isEqualTo(1);

        assertThat(start(uniq()).getStatusCode().value()).isEqualTo(202);

        clock.advance(Duration.ofMinutes(13));
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        assertRateLimited(start(email));
    }

    @Test
    void authenticatedRequestsAreLimitedPerUserAndNothingIdentifyingIsLogged() {
        String email = uniq();
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        Map pair = verify(email, mail.lastCode.get()).getBody();
        String userId = (String) ((Map<?, ?>) pair.get("user")).get("id");
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth((String) pair.get("access_token"));
        for (int i = 0; i < 3; i++) {
            assertThat(http.exchange("/api/v1/sync/pull", HttpMethod.GET, new HttpEntity<>(h), Map.class)
                            .getStatusCode()
                            .value())
                    .isEqualTo(404);
        }
        ResponseEntity<Map> limited = http.exchange("/api/v1/sync/pull", HttpMethod.GET, new HttpEntity<>(h), Map.class);
        assertRateLimited(limited);

        // Trip the per-address limits too.
        String other = uniq();
        for (int i = 0; i < 6; i++) {
            start(other);
        }
        String capped = uniq();
        burnOneCode(capped);
        burnOneCode(capped);
        start(capped);
        assertRateLimited(verify(capped, mail.lastCode.get()));

        String everything = logs.list.stream()
                .map(e -> e.getFormattedMessage() + " " + (e.getThrowableProxy() == null ? "" : ThrowableProxyUtil.asString(e.getThrowableProxy())))
                .reduce("", (a, b) -> a + "\n" + b);
        for (String secret : List.of(email, other, capped, userId, "127.0.0.1", "0:0:0:0:0:0:0:1", "::1", pair.get("access_token").toString())) {
            assertThat(everything).doesNotContain(secret);
        }
        // Not even the local part or digest of an address.
        assertThat(everything).doesNotContain(email.substring(0, email.indexOf('@')));
    }
}
