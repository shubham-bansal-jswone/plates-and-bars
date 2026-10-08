package app.plateandbar.api.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.AuthController;
import app.plateandbar.api.auth.AuthService;
import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.health.HealthController;
import app.plateandbar.api.support.MutableClock;
import app.plateandbar.api.support.WebMvcAuthSlice;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** The request filter end to end through the real security chain, with a controllable clock. */
@WebMvcTest({AuthController.class, HealthController.class})
@WebMvcAuthSlice
@TestPropertySource(properties = {
    "app.rate-limit.public-per-ip.capacity=4",
    "app.rate-limit.public-per-ip.window=60s",
    "app.rate-limit.health-per-ip.capacity=6",
    "app.rate-limit.health-per-ip.window=60s",
    "app.rate-limit.email-start-per-ip.capacity=2",
    "app.rate-limit.email-start-per-ip.window=1h",
    "app.rate-limit.email-verify-per-ip.capacity=3",
    "app.rate-limit.email-verify-per-ip.window=1h",
    "app.rate-limit.authenticated-per-user.capacity=3",
    "app.rate-limit.authenticated-per-user.window=60s"
})
class RateLimitFilterTest {

    @TestConfiguration
    static class ClockConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(Instant.now());
        }
    }

    @Autowired MockMvc mvc;
    @Autowired MutableClock clock;
    @Autowired JwtService jwt;
    @MockitoBean AuthService auth;
    @MockitoBean JdbcTemplate jdbc;

    private static long retryAfter(org.springframework.test.web.servlet.MvcResult r) {
        return Long.parseLong(r.getResponse().getHeader("Retry-After"));
    }

    private static MockHttpServletRequestBuilder from(String ip, MockHttpServletRequestBuilder b) {
        return b.with(r -> {
            r.setRemoteAddr(ip);
            return r;
        });
    }

    private static MockHttpServletRequestBuilder refresh(String ip) {
        return from(ip, post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{}"));
    }

    private static MockHttpServletRequestBuilder start(String ip) {
        return from(ip, post("/api/v1/auth/email/start")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"asha@example.com\"}"));
    }

    @Test
    void publicEndpointsTripPerIpThenRecover() throws Exception {
        for (int i = 0; i < 4; i++) {
            mvc.perform(refresh("203.0.113.1")).andExpect(status().isBadRequest());
        }
        mvc.perform(refresh("203.0.113.1"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(r -> assertThat(retryAfter(r)).isBetween(1L, 15L))
                .andExpect(jsonPath("$.code").value("rate_limited"))
                .andExpect(jsonPath("$.message").isNotEmpty());
        // Another address is unaffected.
        mvc.perform(refresh("203.0.113.2")).andExpect(status().isBadRequest());
        clock.advance(Duration.ofSeconds(15));
        mvc.perform(refresh("203.0.113.1")).andExpect(status().isBadRequest());
        mvc.perform(refresh("203.0.113.1")).andExpect(status().isTooManyRequests());
    }

    @Test
    void googleSignInSharesThePerIpLimit() throws Exception {
        for (int i = 0; i < 4; i++) {
            mvc.perform(from("203.0.113.10", post("/api/v1/auth/google")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"id_token\":\"x\"}")))
                    .andExpect(status().isOk());
        }
        mvc.perform(from("203.0.113.10", post("/api/v1/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id_token\":\"x\"}")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("rate_limited"))
                .andExpect(header().exists("Retry-After"));
    }

    @Test
    void emailStartHasAStricterPerIpLimitWithALongRetryAfter() throws Exception {
        mvc.perform(start("203.0.113.20")).andExpect(status().isAccepted());
        mvc.perform(start("203.0.113.20")).andExpect(status().isAccepted());
        mvc.perform(start("203.0.113.20"))
                .andExpect(status().isTooManyRequests())
                .andExpect(r -> assertThat(retryAfter(r)).isGreaterThan(60L))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        // The refresh endpoint from the same IP still works: only start is tightened.
        mvc.perform(refresh("203.0.113.20")).andExpect(status().isBadRequest());
        clock.advance(Duration.ofMinutes(31));
        mvc.perform(start("203.0.113.20")).andExpect(status().isAccepted());
    }

    @Test
    void emailVerifyHasItsOwnPerIpLimit() throws Exception {
        MockHttpServletRequestBuilder verify = from("203.0.113.30", post("/api/v1/auth/email/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"asha@example.com\",\"code\":\"123456\"}"));
        for (int i = 0; i < 3; i++) {
            mvc.perform(verify).andExpect(status().is(org.hamcrest.Matchers.not(429)));
        }
        mvc.perform(verify).andExpect(status().isTooManyRequests());
    }

    @Test
    void forwardedForCannotMoveARequestToAnotherBucket() throws Exception {
        for (int i = 0; i < 4; i++) {
            mvc.perform(refresh("203.0.113.40").header("X-Forwarded-For", "198.51.100." + i))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(refresh("203.0.113.40").header("X-Forwarded-For", "198.51.100.99"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void authenticatedRequestsAreLimitedPerUserNotPerIp() throws Exception {
        String a = jwt.issue("11111111-1111-1111-1111-111111111111").value();
        String b = jwt.issue("22222222-2222-2222-2222-222222222222").value();
        for (int i = 0; i < 3; i++) {
            mvc.perform(from("203.0.113.50", get("/api/v1/sync/pull").header("Authorization", "Bearer " + a)))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(from("203.0.113.50", get("/api/v1/sync/pull").header("Authorization", "Bearer " + a)))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        // Same IP, other user: not throttled. The per-IP bucket is not consulted for authenticated calls.
        mvc.perform(from("203.0.113.50", get("/api/v1/sync/pull").header("Authorization", "Bearer " + b)))
                .andExpect(status().isNotFound());
        clock.advance(Duration.ofSeconds(21));
        mvc.perform(from("203.0.113.50", get("/api/v1/sync/pull").header("Authorization", "Bearer " + a)))
                .andExpect(status().isNotFound());
    }

    @Test
    void healthHasItsOwnGenerousPerIpLimit() throws Exception {
        for (int i = 0; i < 6; i++) {
            mvc.perform(from("203.0.113.60", get("/api/v1/health"))).andExpect(status().isOk());
        }
        mvc.perform(from("203.0.113.60", get("/api/v1/health")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        // Health traffic does not eat the auth bucket.
        mvc.perform(refresh("203.0.113.60")).andExpect(status().isBadRequest());
    }

    @Test
    void garbageAndExpiredBearerTokensCountAgainstThePerIpLimit() throws Exception {
        for (int i = 0; i < 4; i++) {
            mvc.perform(from("203.0.113.90", get("/api/v1/sync/pull").header("Authorization", "Bearer not.a.jwt")))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(from("203.0.113.90", get("/api/v1/sync/pull").header("Authorization", "Bearer not.a.jwt")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        // Recovers with time like any other per-IP limit.
        clock.advance(Duration.ofSeconds(15));
        mvc.perform(from("203.0.113.90", get("/api/v1/sync/pull").header("Authorization", "Bearer not.a.jwt")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void unauthenticatedHitsOnProtectedRoutesUseThePerIpBucket() throws Exception {
        for (int i = 0; i < 4; i++) {
            mvc.perform(from("203.0.113.70", get("/api/v1/sync/pull"))).andExpect(status().isUnauthorized());
        }
        mvc.perform(from("203.0.113.70", get("/api/v1/sync/pull"))).andExpect(status().isTooManyRequests());
    }

    @Test
    void refusalsLogOnlyTheScopeNotTheAddress() throws Exception {
        var root = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(ch.qos.logback.classic.Logger.ROOT_LOGGER_NAME);
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        var ours = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("app.plateandbar");
        ours.setLevel(ch.qos.logback.classic.Level.TRACE);
        root.addAppender(appender);
        try {
            for (int i = 0; i < 5; i++) {
                mvc.perform(refresh("203.0.113.80"));
            }
            for (int i = 0; i < 3; i++) {
                mvc.perform(start("203.0.113.81"));
            }
        } finally {
            root.detachAppender(appender);
            ours.setLevel(null);
        }
        String all = appender.list.stream().map(e -> e.getFormattedMessage()).reduce("", (a, b) -> a + "\n" + b);
        assertThat(all).contains("public-ip").doesNotContain("203.0.113").doesNotContain("asha");
    }
}
