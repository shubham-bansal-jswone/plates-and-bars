package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.ConcurrentListAppender;
import app.plateandbar.api.support.MutableClock;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.mysql.MySQLContainer;

/**
 * Cookie mode for the web refresh token (#250, ADR 006) over real HTTP, security chain and MySQL: the cookie on sign-in
 * and rotation, reuse, revoke, the CSRF Origin check with nothing changed on refusal, body mode untouched, and no token
 * in any server log.
 */
@AutoConfigureTestRestTemplate
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.auth.cookie-origins=https://app.example.com",
            "app.cors.allowed-origins=https://site.example.com",
            "app.rate-limit.public-per-ip.capacity=100000",
            "app.rate-limit.email-start-per-ip.capacity=100000",
            "app.rate-limit.email-verify-per-ip.capacity=100000",
            "app.rate-limit.authenticated-per-user.capacity=100000",
            "app.rate-limit.email-start-per-address.burst.capacity=100000",
            "app.rate-limit.email-start-per-address.sustained.capacity=100000",
            "app.rate-limit.verify-failures-per-address.burst.capacity=100000",
            "app.rate-limit.verify-failures-per-address.sustained.capacity=100000"
        })
class AuthCookieIT {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4");

    static {
        MYSQL.start(); // stopped by Testcontainers' reaper when the JVM exits
    }

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
    }

    static final String ORIGIN = "https://app.example.com";
    static final String COOKIE = "__Secure-pb_refresh";

    static class CapturingMailSender implements MailSender {
        volatile String lastCode;

        @Override
        public void sendSignInCode(String email, String code, Instant expiresAt) {
            lastCode = code;
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

    private ConcurrentListAppender logs;
    private static final List<String> DEBUG_LOGGERS =
            List.of("app.plateandbar", "org.springframework.security", "org.springframework.web");

    @BeforeEach
    void captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        for (String name : DEBUG_LOGGERS) {
            ((Logger) LoggerFactory.getLogger(name)).setLevel(Level.TRACE);
        }
        logs = new ConcurrentListAppender();
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

    private static String uniq() {
        return "cookie-" + java.util.UUID.randomUUID() + "@example.com";
    }

    private ResponseEntity<Map> call(String path, String transport, String origin, String cookie, String body) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        if (transport != null) {
            h.set("X-Auth-Transport", transport);
        }
        if (origin != null) {
            h.set("Origin", origin);
        }
        if (cookie != null) {
            h.set("Cookie", COOKIE + "=" + cookie);
        }
        return http.exchange("/api/v1/auth" + path, HttpMethod.POST, new HttpEntity<>(body, h), Map.class);
    }

    /** A cookie-mode call from the web app's origin. */
    private ResponseEntity<Map> web(String path, String cookie, String body) {
        return call(path, "cookie", ORIGIN, cookie, body);
    }

    private ResponseEntity<Map> signInWeb(String email) {
        assertThat(call("/email/start", null, null, null, "{\"email\":\"" + email + "\"}").getStatusCode().value())
                .isEqualTo(202);
        return web("/email/verify", null, "{\"email\":\"" + email + "\",\"code\":\"" + mail.lastCode + "\"}");
    }

    /** The token in the response's refresh cookie, or null when there is no (or a clearing) Set-Cookie. */
    private static String cookieValue(ResponseEntity<?> res) {
        List<String> set = res.getHeaders().get(HttpHeaders.SET_COOKIE);
        if (set == null) {
            return null;
        }
        assertThat(set).hasSize(1);
        String first = set.get(0).split(";")[0];
        assertThat(first).startsWith(COOKIE + "=");
        String value = first.substring((COOKIE + "=").length());
        return value.isEmpty() ? null : value;
    }

    /** The one Set-Cookie header, character for character as the contract gives it; {@code maxAge} 0 is the clearing form. */
    private static void assertSetCookie(ResponseEntity<?> res, long maxAge) {
        List<String> set = res.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertThat(set).hasSize(1);
        String token = maxAge == 0 ? "" : set.get(0).split(";")[0].substring((COOKIE + "=").length());
        assertThat(set.get(0)).isEqualTo(
                COOKIE + "=" + token + "; Path=/api/v1/auth/refresh; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Strict");
        if (maxAge != 0) {
            assertThat(token).startsWith("rt_");
        }
    }

    /** Reuse lines (order-independent: filtered by content, counted, never indexed). */
    private List<ILoggingEvent> reuseLines() {
        return logs.list.stream()
                .filter(e -> e.getFormattedMessage().startsWith("Refresh token reuse"))
                .toList();
    }

    private static String sha256(String v) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(v.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private int liveTokens(Object userId) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL", Integer.class, userId);
    }

    private static Object userId(ResponseEntity<Map> res) {
        return ((Map<?, ?>) res.getBody().get("user")).get("id");
    }

    // ---- the cookie on sign-in and refresh ----

    @Test
    void signInSetsTheCookieAndTheBodyTokenIsEmptyAndOnlyAHashIsStored() {
        ResponseEntity<Map> res = signInWeb(uniq());
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody().get("refresh_token")).isEqualTo("");
        assertThat(res.getBody().get("access_token")).asString().isNotBlank();
        assertSetCookie(res, 7776000);
        String token = cookieValue(res);
        assertThat(token).startsWith("rt_");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = ?", Integer.class, sha256(token)))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = ?", Integer.class, token))
                .isZero();
    }

    @Test
    void googleSignInInCookieModeSetsTheCookieToo() {
        String sub = "sub-" + java.util.UUID.randomUUID();
        when(google.verify("g-" + sub)).thenReturn(new GoogleIdTokenVerifier.GoogleIdentity(sub, uniq()));
        ResponseEntity<Map> res = web("/google", null, "{\"id_token\":\"g-" + sub + "\"}");
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody().get("refresh_token")).isEqualTo("");
        assertSetCookie(res, 7776000);
        assertThat(web("/refresh", cookieValue(res), "{}").getStatusCode().value()).isEqualTo(200);

        // A refused Google token is a plain 401 with no cookie to set or clear.
        when(google.verify("g-bad")).thenThrow(ApiException.unauthorized());
        ResponseEntity<Map> bad = web("/google", null, "{\"id_token\":\"g-bad\"}");
        assertThat(bad.getStatusCode().value()).isEqualTo(401);
        assertThat(bad.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
    }

    @Test
    void cookieModeReuseLogsOneWarnWithoutTokenMaterial() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String first = cookieValue(in);
        String second = cookieValue(web("/refresh", first, "{}"));
        clock.advance(Duration.ofSeconds(61));
        assertThat(reuseLines()).isEmpty();

        assertThat(web("/refresh", first, "{}").getStatusCode().value()).isEqualTo(401);
        assertThat(web("/refresh", first, "{}").getStatusCode().value()).isEqualTo(401); // replay: same family

        assertThat(reuseLines()).hasSize(1);
        ILoggingEvent line = reuseLines().get(0);
        assertThat(line.getLevel()).isEqualTo(Level.WARN);
        String text = line.getFormattedMessage();
        assertThat(text).contains("reason=rotated_token_reused", "user=" + userId(in), "family=");
        for (String token : List.of(first, second)) {
            assertThat(text).doesNotContain(token).doesNotContain(token.substring(3, 12));
        }
    }

    @Test
    void refreshRotatesAndReplacesTheCookieAndTheOldTokenIsReuse() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String first = cookieValue(in);

        ResponseEntity<Map> rotated = web("/refresh", first, "{}");
        assertThat(rotated.getStatusCode().value()).isEqualTo(200);
        assertThat(rotated.getBody().get("refresh_token")).isEqualTo("");
        assertSetCookie(rotated, 7776000);
        String second = cookieValue(rotated);
        assertThat(second).isNotEqualTo(first);
        assertThat(((Map<?, ?>) rotated.getBody().get("user")).get("id")).isEqualTo(userId(in));
        assertThat(web("/refresh", second, "{}").getStatusCode().value()).isEqualTo(200);

        // The first token is long rotated: presenting it is theft, which ends the whole session and clears the cookie.
        clock.advance(Duration.ofSeconds(61));
        ResponseEntity<Map> reuse = web("/refresh", first, "{}");
        assertThat(reuse.getStatusCode().value()).isEqualTo(401);
        assertThat(reuse.getBody().get("code")).isEqualTo("unauthorized");
        assertSetCookie(reuse, 0);
        assertThat(cookieValue(reuse)).isNull();
        assertThat(liveTokens(userId(in))).isZero();
        ResponseEntity<Map> after = web("/refresh", second, "{}");
        assertThat(after.getStatusCode().value()).isEqualTo(401);
        assertSetCookie(after, 0);
    }

    @Test
    void everyKindOfRefreshRefusalClearsTheCookie() {
        // No cookie, unknown token, expired token.
        ResponseEntity<Map> none = web("/refresh", null, "{}");
        assertThat(none.getStatusCode().value()).isEqualTo(401);
        assertSetCookie(none, 0);
        ResponseEntity<Map> unknown = web("/refresh", "rt_unknown", "{}");
        assertThat(unknown.getStatusCode().value()).isEqualTo(401);
        assertSetCookie(unknown, 0);

        String token = cookieValue(signInWeb(uniq()));
        clock.advance(Duration.ofDays(91));
        ResponseEntity<Map> expired = web("/refresh", token, "{}");
        assertThat(expired.getStatusCode().value()).isEqualTo(401);
        assertSetCookie(expired, 0);
    }

    // ---- without the header the cookie is ignored, and a body token is refused in cookie mode ----

    @Test
    void withoutTheHeaderTheCookieIsIgnoredAndNothingIsSet() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String token = cookieValue(in);

        for (String transport : new String[] {null, "Cookie", "body"}) {
            ResponseEntity<Map> noBody = call("/refresh", transport, null, token, "{}");
            assertThat(noBody.getStatusCode().value()).as("[" + transport + "] cookie alone is not a token").isEqualTo(400);
            assertThat(noBody.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        }
        // Body mode with a body token and an unrelated cookie uses the body token and sets no cookie.
        String other = (String) signInBody(uniq()).getBody().get("refresh_token");
        ResponseEntity<Map> res = call("/refresh", null, null, token, "{\"refresh_token\":\"" + other + "\"}");
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        assertThat(res.getBody().get("refresh_token")).asString().startsWith("rt_").isNotEqualTo(other);

        // The cookie's own session was never touched by any of that.
        assertThat(web("/refresh", token, "{}").getStatusCode().value()).isEqualTo(200);
    }

    private ResponseEntity<Map> signInBody(String email) {
        call("/email/start", null, null, null, "{\"email\":\"" + email + "\"}");
        return call("/email/verify", null, null, null, "{\"email\":\"" + email + "\",\"code\":\"" + mail.lastCode + "\"}");
    }

    @Test
    void bodyModeSignInIsUnchangedNoCookieAndTheTokenInTheBody() {
        ResponseEntity<Map> res = signInBody(uniq());
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        assertThat(res.getBody().get("refresh_token")).asString().startsWith("rt_");
    }

    @Test
    void aBodyTokenInCookieModeIs400EvenEmptyAndTheSessionIsUntouched() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String token = cookieValue(in);
        for (String body : new String[] {"{\"refresh_token\":\"" + token + "\"}", "{\"refresh_token\":\"\"}", "{\"refresh_token\":null}"}) {
            for (String path : new String[] {"/refresh", "/refresh/revoke"}) {
                ResponseEntity<Map> res = web(path, token, body);
                assertThat(res.getStatusCode().value()).as(path + " " + body.length()).isEqualTo(400);
                assertThat(res.getBody().get("code")).isEqualTo("invalid_request");
                assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
            }
        }
        assertThat(liveTokens(userId(in))).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND rotated_at IS NOT NULL",
                        Integer.class, userId(in))).isZero();
        assertThat(web("/refresh", token, "{}").getStatusCode().value()).isEqualTo(200);
    }

    // ---- CSRF ----

    @Test
    void aWrongOrMissingOriginIs403AndChangesNothingNotEvenTheSignInCode() {
        String email = uniq();
        assertThat(call("/email/start", null, null, null, "{\"email\":\"" + email + "\"}").getStatusCode().value()).isEqualTo(202);
        String code = mail.lastCode;
        String verify = "{\"email\":\"" + email + "\",\"code\":\"" + code + "\"}";
        for (String origin : new String[] {null, "https://evil.example.org", "https://site.example.com"}) {
            ResponseEntity<Map> res = call("/email/verify", "cookie", origin, null, verify);
            assertThat(res.getStatusCode().value()).as("origin " + origin).isEqualTo(403);
            assertThat(res.getBody().get("code")).isEqualTo("forbidden");
            assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        }
        // A login-CSRF attempt created no account and used up no code: the real sign-in with the same code still works.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, email)).isZero();
        ResponseEntity<Map> ok = web("/email/verify", null, verify);
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
        assertSetCookie(ok, 7776000);
    }

    @Test
    void aWrongOriginLeavesTheSessionAndTheCookieAloneOnRefreshAndRevoke() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String token = cookieValue(in);
        for (String path : new String[] {"/refresh", "/refresh/revoke"}) {
            ResponseEntity<Map> res = call(path, "cookie", "https://evil.example.org", token, "{}");
            assertThat(res.getStatusCode().value()).isEqualTo(403);
            assertThat(res.getBody().get("code")).isEqualTo("forbidden");
            assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        }
        assertThat(liveTokens(userId(in))).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND rotated_at IS NOT NULL",
                        Integer.class, userId(in))).isZero();
        assertThat(web("/refresh", token, "{}").getStatusCode().value()).isEqualTo(200);
    }

    // ---- revoke ----

    @Test
    void revokeEndsTheSessionClearsTheCookieAndIsIdempotent() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String token = cookieValue(in);
        ResponseEntity<Map> otherDevice = signInWeb(uniq());

        ResponseEntity<Map> first = web("/refresh/revoke", token, "{}");
        assertThat(first.getStatusCode().value()).isEqualTo(204);
        assertSetCookie(first, 0);
        assertThat(cookieValue(first)).isNull();
        assertThat(liveTokens(userId(in))).isZero();
        ResponseEntity<Map> again = web("/refresh/revoke", token, "{}");
        assertThat(again.getStatusCode().value()).isEqualTo(204);
        assertSetCookie(again, 0);
        assertThat(web("/refresh", token, "{}").getStatusCode().value()).isEqualTo(401);

        // Another account's session is its own.
        assertThat(web("/refresh", cookieValue(otherDevice), "{}").getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void revokeWithARotatedOrExpiredTokenStillEndsTheWholeSession() {
        ResponseEntity<Map> in = signInWeb(uniq());
        String old = cookieValue(in);
        String current = cookieValue(web("/refresh", old, "{}"));
        assertThat(web("/refresh/revoke", old, "{}").getStatusCode().value()).isEqualTo(204);
        assertThat(liveTokens(userId(in))).isZero();
        assertThat(web("/refresh", current, "{}").getStatusCode().value()).isEqualTo(401);

        ResponseEntity<Map> second = signInWeb(uniq());
        String token = cookieValue(second);
        clock.advance(Duration.ofDays(91));
        assertThat(web("/refresh/revoke", token, "{}").getStatusCode().value()).isEqualTo(204);
        assertThat(liveTokens(userId(second))).isZero();
    }

    @Test
    void revokeOfAnUnknownTokenOrNoCookieIs204AndRevokesNothing() {
        ResponseEntity<Map> in = signInWeb(uniq());
        for (String cookie : new String[] {null, "rt_unknown", ""}) {
            ResponseEntity<Map> res = web("/refresh/revoke", cookie, "{}");
            assertThat(res.getStatusCode().value()).isEqualTo(204);
            assertSetCookie(res, 0);
        }
        assertThat(liveTokens(userId(in))).isEqualTo(1);
    }

    @Test
    void revokeInBodyModeEndsTheSessionWithoutACookie() {
        ResponseEntity<Map> in = signInBody(uniq());
        String token = (String) in.getBody().get("refresh_token");
        ResponseEntity<Map> res = call("/refresh/revoke", null, null, null, "{\"refresh_token\":\"" + token + "\"}");
        assertThat(res.getStatusCode().value()).isEqualTo(204);
        assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        assertThat(call("/refresh", null, null, null, "{\"refresh_token\":\"" + token + "\"}").getStatusCode().value())
                .isEqualTo(401);
        assertThat(call("/refresh/revoke", null, null, null, "{}").getStatusCode().value()).isEqualTo(400);
    }

    // ---- CORS over the real chain ----

    @Test
    void thePreflightOfTheWebAppOriginAllowsTheHeaderWithCredentials() {
        HttpHeaders h = new HttpHeaders();
        h.set("Origin", ORIGIN);
        h.set("Access-Control-Request-Method", "POST");
        h.set("Access-Control-Request-Headers", "x-auth-transport,content-type");
        ResponseEntity<String> res = http.exchange("/api/v1/auth/refresh", HttpMethod.OPTIONS, new HttpEntity<>(h), String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getHeaders().getFirst("Access-Control-Allow-Origin")).isEqualTo(ORIGIN);
        assertThat(res.getHeaders().getFirst("Access-Control-Allow-Credentials")).isEqualTo("true");

        h.set("Origin", "https://site.example.com");
        ResponseEntity<String> other = http.exchange("/api/v1/auth/refresh", HttpMethod.OPTIONS, new HttpEntity<>(h), String.class);
        // A CORS-only origin gets the allowed subset of the headers (without X-Auth-Transport, so its browser refuses to
        // send the request) and no credentials.
        assertThat(other.getHeaders().getFirst("Access-Control-Allow-Credentials")).isNull();
        assertThat(String.valueOf(other.getHeaders().getFirst("Access-Control-Allow-Headers")).toLowerCase())
                .doesNotContain("x-auth-transport");
    }

    // ---- logs ----

    @Test
    void aBodyModeTokenIsNeverPrintedEvenWithSpringsBodyLoggersAtTrace() {
        List<String> bodyLoggers = List.of(
                "org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor",
                "org.springframework.web.servlet.mvc.method.annotation.HttpEntityMethodProcessor",
                "org.springframework.web.servlet.DispatcherServlet");
        bodyLoggers.forEach(n -> ((Logger) LoggerFactory.getLogger(n)).setLevel(Level.TRACE));
        try {
            ResponseEntity<Map> in = signInBody(uniq());
            String token = (String) in.getBody().get("refresh_token");
            ResponseEntity<Map> rotated = call("/refresh", null, null, null, "{\"refresh_token\":\"" + token + "\"}");
            String second = (String) rotated.getBody().get("refresh_token");
            call("/refresh/revoke", null, null, null, "{\"refresh_token\":\"" + second + "\"}");
            call("/refresh", "cookie", ORIGIN, null, "{\"refresh_token\":\"rt_body_in_cookie_mode\"}");
            for (ILoggingEvent event : logs.list) {
                if ("Test worker".equals(event.getThreadName())) {
                    continue;
                }
                String text = event.getFormattedMessage();
                assertThat(text).doesNotContain(token).doesNotContain(second).doesNotContain("rt_body_in_cookie_mode");
            }
        } finally {
            bodyLoggers.forEach(n -> ((Logger) LoggerFactory.getLogger(n)).setLevel(null));
        }
    }

    @Test
    void noTokenCookieOrCodeReachesTheLogs() {
        String email = uniq();
        ResponseEntity<Map> in = signInWeb(email);
        String code = mail.lastCode;
        String first = cookieValue(in);
        String second = cookieValue(web("/refresh", first, "{}"));
        clock.advance(Duration.ofSeconds(61));
        web("/refresh", first, "{}"); // reuse path
        web("/refresh", "rt_made_up_token_value", "{}"); // unknown
        web("/refresh/revoke", second, "{}");
        web("/refresh", second, "{\"refresh_token\":\"rt_in_a_body_secret\"}"); // refused body token
        call("/refresh", "cookie", "https://evil.example.org", "rt_csrf_cookie_secret", "{}");

        List<String> secrets = new ArrayList<>(List.of(first, second, "rt_made_up_token_value", "rt_in_a_body_secret",
                "rt_csrf_cookie_secret", code, email, (String) in.getBody().get("access_token")));
        assertThat(logs.list).isNotEmpty();
        for (ILoggingEvent event : logs.list) {
            if ("Test worker".equals(event.getThreadName())) {
                continue; // the test's own HTTP client
            }
            String text = event.getFormattedMessage() + " " + ThrowableProxyUtil.asString(event.getThrowableProxy());
            for (String secret : secrets) {
                assertThat(text).as("log line must not contain a secret").doesNotContain(secret);
            }
        }
    }
}
