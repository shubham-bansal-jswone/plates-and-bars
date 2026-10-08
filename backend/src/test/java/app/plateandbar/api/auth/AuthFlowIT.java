package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.MutableClock;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Real MySQL, real Flyway, real HTTP: sign-in, linking, code rules, refresh rotation, and log hygiene. */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthFlowIT {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
    }

    /** Delegates to the real logging sender so the log test covers it, and remembers the last code. */
    static class CapturingMailSender implements MailSender {
        final LoggingMailSender delegate = new LoggingMailSender();
        volatile String lastCode;
        final List<String> codes = new ArrayList<>();

        @Override
        public void sendSignInCode(String email, String code, Instant expiresAt) {
            lastCode = code;
            codes.add(code);
            delegate.sendSignInCode(email, code, expiresAt);
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
        CapturingMailSender capturingMailSender() {
            return new CapturingMailSender();
        }
    }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;
    @Autowired CapturingMailSender mail;
    @MockitoBean GoogleIdTokenVerifier google;

    private ListAppender<ILoggingEvent> logs;
    private static final List<String> DEBUG_LOGGERS =
            List.of("app.plateandbar", "org.springframework.security", "org.springframework.web.servlet");

    @BeforeEach
    void captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        // DEBUG for our code and the server-side request/security machinery. Not root: the test's own
        // HTTP client and Spring's DEBUG body logging would otherwise log request/response bodies.
        for (String name : DEBUG_LOGGERS) {
            ((Logger) LoggerFactory.getLogger(name)).setLevel(Level.DEBUG);
        }
        logs = new ListAppender<>();
        logs.start();
        root.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.detachAppender(logs);
        for (String name : DEBUG_LOGGERS) {
            ((Logger) LoggerFactory.getLogger(name)).setLevel(null);
        }
    }

    // ---- helpers ----

    private ResponseEntity<Map> post(String path, Map<String, ?> body) {
        return http.postForEntity("/api/v1/auth" + path, body, Map.class);
    }

    private ResponseEntity<Map> start(String email) {
        return post("/email/start", Map.of("email", email));
    }

    private ResponseEntity<Map> verify(String email, String code) {
        return post("/email/verify", Map.of("email", email, "code", code));
    }

    private Map signInByEmail(String email) {
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
        ResponseEntity<Map> res = verify(email, mail.lastCode);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        return res.getBody();
    }

    private ResponseEntity<Map> refresh(Object token) {
        return post("/refresh", Map.of("refresh_token", token));
    }

    private static String uniq(String prefix) {
        return prefix + "-" + java.util.UUID.randomUUID() + "@example.com";
    }

    private static Map<?, ?> user(Map pair) {
        return (Map<?, ?>) pair.get("user");
    }

    private int protectedStatus(String accessToken) {
        HttpHeaders h = new HttpHeaders();
        if (accessToken != null) {
            h.setBearerAuth(accessToken);
        }
        return http.exchange("/api/v1/sync/pull", HttpMethod.GET, new HttpEntity<>(h), Map.class)
                .getStatusCode()
                .value();
    }

    private void googleReturns(String sub, String email) {
        when(google.verify("g-" + sub)).thenReturn(new GoogleIdTokenVerifier.GoogleIdentity(sub, Emails.normalise(email)));
    }

    // ---- email code ----

    @Test
    void emailSignInCreatesAccountThenReusesIt() {
        String email = uniq("a");
        Map first = signInByEmail(email);
        assertThat(first.get("new_user")).isEqualTo(true);
        assertThat(first.get("token_type")).isEqualTo("Bearer");
        assertThat(user(first).get("email")).isEqualTo(email);

        Map second = signInByEmail(email.toUpperCase());
        assertThat(second.get("new_user")).isEqualTo(false);
        assertThat(user(second).get("id")).isEqualTo(user(first).get("id"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, email)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                        "SELECT provider_subject FROM auth_identities WHERE provider = 'email' AND user_id = ?",
                        String.class,
                        user(first).get("id")))
                .isEqualTo(email);
    }

    @Test
    void startIs202ForKnownAndUnknownAddressesAndStoresOnlyAHash() {
        String email = uniq("b");
        ResponseEntity<Map> unknown = start(email);
        assertThat(unknown.getStatusCode().value()).isEqualTo(202);
        assertThat(unknown.getBody()).containsKeys("code_expires_at", "resend_after_seconds");
        String stored = jdbc.queryForObject("SELECT code_hash FROM email_sign_in_codes WHERE email = ?", String.class, email);
        assertThat(stored).hasSize(64).isNotEqualTo(mail.lastCode);

        signInByEmail(email);
        assertThat(start(email).getStatusCode().value()).isEqualTo(202);
    }

    @Test
    void codeIsSingleUse() {
        String email = uniq("c");
        signInByEmail(email);
        ResponseEntity<Map> again = verify(email, mail.lastCode);
        assertThat(again.getStatusCode().value()).isEqualTo(401);
        assertThat(again.getBody().get("code")).isEqualTo("invalid_code");
    }

    @Test
    void codeExpiresAfterTenMinutes() {
        String email = uniq("d");
        start(email);
        clock.advance(Duration.ofMinutes(10).plusSeconds(1));
        ResponseEntity<Map> res = verify(email, mail.lastCode);
        assertThat(res.getStatusCode().value()).isEqualTo(401);
        assertThat(res.getBody().get("code")).isEqualTo("invalid_code");
    }

    @Test
    void codeStillWorksJustBeforeExpiry() {
        String email = uniq("d2");
        start(email);
        clock.advance(Duration.ofMinutes(9).plusSeconds(59));
        assertThat(verify(email, mail.lastCode).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void fiveWrongAttemptsInvalidateTheCodeEvenIfTheSixthIsRight() {
        String email = uniq("e");
        start(email);
        String right = mail.lastCode;
        String wrong = right.equals("000000") ? "000001" : "000000";
        for (int i = 0; i < 5; i++) {
            ResponseEntity<Map> res = verify(email, wrong);
            assertThat(res.getStatusCode().value()).isEqualTo(401);
            assertThat(res.getBody().get("code")).isEqualTo("invalid_code");
        }
        assertThat(verify(email, right).getStatusCode().value()).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT attempts FROM email_sign_in_codes WHERE email = ?", Integer.class, email))
                .isEqualTo(5);

        // A fresh code resets the counter and works.
        start(email);
        assertThat(verify(email, mail.lastCode).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void fourWrongAttemptsThenRightCodeStillSucceeds() {
        String email = uniq("f");
        start(email);
        String right = mail.lastCode;
        String wrong = right.equals("000000") ? "000001" : "000000";
        for (int i = 0; i < 4; i++) {
            verify(email, wrong);
        }
        assertThat(verify(email, right).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void newCodeReplacesTheOldOne() {
        String email = uniq("g");
        start(email);
        String old = mail.lastCode;
        start(email);
        String fresh = mail.lastCode;
        if (!old.equals(fresh)) {
            assertThat(verify(email, old).getStatusCode().value()).isEqualTo(401);
        }
        assertThat(verify(email, fresh).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void verifyWithoutEverStartingIsInvalidCodeNotAnEnumerationLeak() {
        ResponseEntity<Map> res = verify(uniq("never"), "123456");
        assertThat(res.getStatusCode().value()).isEqualTo(401);
        assertThat(res.getBody().get("code")).isEqualTo("invalid_code");
    }

    // ---- Google and linking ----

    @Test
    void googleCreatesAccountThenSignsInAgainBySub() {
        String sub = "sub-" + java.util.UUID.randomUUID();
        String email = uniq("gg");
        googleReturns(sub, email);
        Map first = post("/google", Map.of("id_token", "g-" + sub)).getBody();
        assertThat(first.get("new_user")).isEqualTo(true);
        Map second = post("/google", Map.of("id_token", "g-" + sub)).getBody();
        assertThat(second.get("new_user")).isEqualTo(false);
        assertThat(user(second).get("id")).isEqualTo(user(first).get("id"));
    }

    @Test
    void googleRefusalIs401() {
        when(google.verify("g-bad")).thenThrow(ApiException.unauthorized());
        ResponseEntity<Map> res = post("/google", Map.of("id_token", "g-bad"));
        assertThat(res.getStatusCode().value()).isEqualTo(401);
        assertThat(res.getBody().get("code")).isEqualTo("unauthorized");
    }

    @Test
    void googleLinksToExistingEmailAccountAndEmailLinksToGoogleAccount() {
        String email = uniq("link");
        Map viaEmail = signInByEmail(email);

        String sub = "sub-" + java.util.UUID.randomUUID();
        googleReturns(sub, email.toUpperCase());
        Map viaGoogle = post("/google", Map.of("id_token", "g-" + sub)).getBody();
        assertThat(viaGoogle.get("new_user")).isEqualTo(false);
        assertThat(user(viaGoogle).get("id")).isEqualTo(user(viaEmail).get("id"));
        assertThat(jdbc.queryForObject(
                        "SELECT COUNT(*) FROM auth_identities WHERE user_id = ?", Integer.class, user(viaEmail).get("id")))
                .isEqualTo(2);

        // Reverse order: Google first, then the email code reaches the same account.
        String email2 = uniq("link2");
        String sub2 = "sub-" + java.util.UUID.randomUUID();
        googleReturns(sub2, email2);
        Map g = post("/google", Map.of("id_token", "g-" + sub2)).getBody();
        Map e = signInByEmail(email2);
        assertThat(e.get("new_user")).isEqualTo(false);
        assertThat(user(e).get("id")).isEqualTo(user(g).get("id"));
    }

    @Test
    void existingGoogleIdentityIsNeverRepointedByEmail() {
        String sub = "sub-" + java.util.UUID.randomUUID();
        String emailA = uniq("owner");
        googleReturns(sub, emailA);
        Map a = post("/google", Map.of("id_token", "g-" + sub)).getBody();

        // Someone else owns emailB. The same Google sub now presents emailB: it must stay with account A.
        Map b = signInByEmail(uniq("other"));
        String emailB = (String) user(b).get("email");
        googleReturns(sub, emailB);
        Map again = post("/google", Map.of("id_token", "g-" + sub)).getBody();
        assertThat(user(again).get("id")).isEqualTo(user(a).get("id"));
        assertThat(user(again).get("id")).isNotEqualTo(user(b).get("id"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_identities WHERE provider_subject = ?", Integer.class, sub))
                .isEqualTo(1);
    }

    // ---- refresh rotation ----

    @Test
    void refreshRotatesAndRestartsNinetyDayLifetime() {
        Map pair = signInByEmail(uniq("r1"));
        Instant issued = clock.instant();
        assertThat(Instant.parse((String) pair.get("refresh_token_expires_at"))).isEqualTo(issued.plus(Duration.ofDays(90)));
        assertThat(Instant.parse((String) pair.get("access_token_expires_at"))).isEqualTo(issued.plus(Duration.ofMinutes(15)));

        clock.advance(Duration.ofDays(60));
        ResponseEntity<Map> res = refresh(pair.get("refresh_token"));
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        Map next = res.getBody();
        assertThat(next.get("refresh_token")).isNotEqualTo(pair.get("refresh_token"));
        assertThat(next.get("new_user")).isEqualTo(false);
        assertThat(user(next).get("id")).isEqualTo(user(pair).get("id"));
        assertThat(Instant.parse((String) next.get("refresh_token_expires_at")))
                .isEqualTo(clock.instant().plus(Duration.ofDays(90)));

        // 60 days later the original 90-day window has passed but the restarted one has not.
        clock.advance(Duration.ofDays(60));
        assertThat(refresh(next.get("refresh_token")).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void reuseOfRotatedTokenRevokesTheWholeFamily() {
        Map first = signInByEmail(uniq("r2"));
        Map second = refresh(first.get("refresh_token")).getBody();
        Map third = refresh(second.get("refresh_token")).getBody();

        ResponseEntity<Map> reuse = refresh(first.get("refresh_token"));
        assertThat(reuse.getStatusCode().value()).isEqualTo(401);
        assertThat(reuse.getBody().get("code")).isEqualTo("unauthorized");

        // The legitimate newest token is dead too.
        ResponseEntity<Map> newest = refresh(third.get("refresh_token"));
        assertThat(newest.getStatusCode().value()).isEqualTo(401);
        assertThat(newest.getBody().get("code")).isEqualTo("unauthorized");
        assertThat(jdbc.queryForObject(
                        "SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL",
                        Integer.class,
                        user(first).get("id")))
                .isZero();
    }

    @Test
    void reuseRevokesOnlyThatFamilyNotOtherSessionsOfTheUser() {
        String email = uniq("r3");
        Map deviceA = signInByEmail(email);
        Map deviceB = signInByEmail(email);
        refresh(deviceA.get("refresh_token"));
        assertThat(refresh(deviceA.get("refresh_token")).getStatusCode().value()).isEqualTo(401);
        assertThat(refresh(deviceB.get("refresh_token")).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void expiredUnknownAndMalformedRefreshTokensAre401() {
        Map pair = signInByEmail(uniq("r4"));
        assertThat(refresh("rt_does_not_exist").getStatusCode().value()).isEqualTo(401);
        clock.advance(Duration.ofDays(90));
        ResponseEntity<Map> res = refresh(pair.get("refresh_token"));
        assertThat(res.getStatusCode().value()).isEqualTo(401);
        assertThat(res.getBody().get("code")).isEqualTo("unauthorized");
    }

    @Test
    void refreshTokensAreStoredHashedWithAFamilyId() {
        Map pair = signInByEmail(uniq("r5"));
        String raw = (String) pair.get("refresh_token");
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT token_hash, family_id FROM refresh_tokens WHERE user_id = ?", user(pair).get("id"));
        assertThat(rows).hasSize(1);
        assertThat((String) rows.get(0).get("token_hash")).hasSize(64).isNotEqualTo(raw).doesNotContain(raw);
        assertThat(rows.get(0).get("family_id")).isNotNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = ?", Integer.class, raw))
                .isZero();
    }

    // ---- protected-route filter ----

    @Test
    void accessTokenGatesProtectedRoutesAndExpiresAfterFifteenMinutes() {
        Map pair = signInByEmail(uniq("p1"));
        String access = (String) pair.get("access_token");
        assertThat(protectedStatus(null)).isEqualTo(401);
        assertThat(protectedStatus("garbage")).isEqualTo(401);
        // No sync controller yet, so a valid token reaches routing and gets 404 rather than 401.
        assertThat(protectedStatus(access)).isEqualTo(404);

        clock.advance(Duration.ofMinutes(15));
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(access);
        ResponseEntity<Map> expired = http.exchange("/api/v1/sync/pull", HttpMethod.GET, new HttpEntity<>(h), Map.class);
        assertThat(expired.getStatusCode().value()).isEqualTo(401);
        assertThat(expired.getBody().get("code")).isEqualTo("token_expired");
    }

    // ---- log hygiene ----

    @Test
    void noTokenCodeOrEmailEverReachesTheLogs() {
        String email = uniq("log");
        String sub = "sub-" + java.util.UUID.randomUUID();
        String gEmail = uniq("loggoogle");
        googleReturns(sub, gEmail);

        Map pair = signInByEmail(email);
        String code = mail.lastCode;
        Map rotated = refresh(pair.get("refresh_token")).getBody();
        refresh(pair.get("refresh_token")); // reuse path
        verify(email, "999999"); // wrong-code path
        post("/google", Map.of("id_token", "g-" + sub));
        http.postForEntity("/api/v1/auth/email/start", Map.of("email", "not-an-email"), Map.class);
        protectedStatus((String) rotated.get("access_token"));

        List<String> secrets = List.of(
                code,
                email,
                gEmail,
                (String) pair.get("access_token"),
                (String) pair.get("refresh_token"),
                (String) rotated.get("access_token"),
                (String) rotated.get("refresh_token"),
                "g-" + sub);
        assertThat(logs.list).isNotEmpty();
        for (ILoggingEvent event : logs.list) {
            String text = event.getFormattedMessage() + " " + event.getThrowableProxy();
            for (String secret : secrets) {
                assertThat(text).as("log line must not contain a secret").doesNotContain(secret);
            }
        }
        assertThat(logs.list.stream().map(ILoggingEvent::getFormattedMessage))
                .anyMatch(m -> m.startsWith("Sign-in code issued"));
    }
}
