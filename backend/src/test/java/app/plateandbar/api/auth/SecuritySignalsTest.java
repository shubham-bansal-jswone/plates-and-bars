package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.ratelimit.RateLimitedException;
import app.plateandbar.api.support.WebMvcAuthSlice;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Detection signals (#714) through the real security chain: refused auth and rate-limit hits are logged at INFO with
 * a path template and a reason code, never a token, e-mail address, query string or IP. Each test uses its own client address, so the shared in-memory buckets never couple tests, and lines are found
 * by content and counted, never by position.
 */
@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {"app.rate-limit.public-per-ip.capacity=4", "app.rate-limit.public-per-ip.window=60s"})
class SecuritySignalsTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean AuthService auth;
    @MockitoBean UserExistenceCheck users;

    private Logger security;
    private ch.qos.logback.core.read.ListAppender<ILoggingEvent> lines;

    @BeforeEach
    void capture() {
        security = (Logger) LoggerFactory.getLogger("app.plateandbar.security");
        security.setLevel(Level.INFO);
        lines = new ch.qos.logback.core.read.ListAppender<>();
        lines.start();
        security.addAppender(lines);
        when(users.exists(anyString())).thenReturn(true);
    }

    @AfterEach
    void release() {
        security.detachAppender(lines);
        security.setLevel(null);
    }

    private static RequestPostProcessor from(String ip) {
        return r -> {
            r.setRemoteAddr(ip);
            return r;
        };
    }

    private List<String> messages(String startsWith) {
        return lines.list.stream()
                .filter(e -> e.getLevel() == Level.INFO)
                .map(ILoggingEvent::getFormattedMessage)
                .filter(m -> m.startsWith(startsWith))
                .toList();
    }

    @Test
    void missingTokenIsLoggedWithTemplateAndReason() throws Exception {
        mvc.perform(get("/api/v1/sync/pull").with(from("10.1.0.1"))).andExpect(status().isUnauthorized());
        assertThat(messages("Auth refused"))
                .containsExactly("Auth refused (status=401, method=GET, path=/api/v1/sync/pull, reason=missing_token)");
    }

    @Test
    void badTokenIsLoggedWithoutTokenQueryOrIds() throws Exception {
        String garbage = "SecretBearerValue.abc.def";
        mvc.perform(get("/api/v1/sync/records/123e4567-e89b-12d3-a456-426614174000?email=asha@example.com")
                        .header("Authorization", "Bearer " + garbage)
                        .with(from("10.1.0.2")))
                .andExpect(status().isUnauthorized());
        List<String> out = messages("Auth refused");
        assertThat(out).hasSize(1);
        assertThat(out.get(0))
                .contains("status=401", "method=GET", "path=/api/v1/sync/records/{id}", "reason=unauthorized")
                .doesNotContain(garbage, "SecretBearerValue", "asha", "example.com", "123e4567", "10.1.0.2");
    }

    @Test
    void expiredTokenHasItsOwnReason() throws Exception {
        security.setLevel(Level.DEBUG);
        String expired = jwt.issue("11111111-1111-1111-1111-111111111111").value();
        when(users.exists(anyString())).thenThrow(ApiException.tokenExpired());
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer " + expired).with(from("10.1.0.3")))
                .andExpect(status().isUnauthorized());
        // routine (once per access-token lifetime per client): not at INFO
        assertThat(messages("Auth refused")).isEmpty();
        assertThat(lines.list).anyMatch(e -> e.getLevel() == Level.DEBUG && e.getFormattedMessage().contains("reason=token_expired"));
    }

    @Test
    void controllerRefusalKeepsItsErrorCodeAsReason() throws Exception {
        when(auth.verifyEmailSignIn(anyString(), anyString())).thenThrow(ApiException.invalidCode());
        mvc.perform(post("/api/v1/auth/email/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"asha@example.com\",\"code\":\"123456\"}")
                        .with(from("10.1.0.4")))
                .andExpect(status().isUnauthorized());
        List<String> out = messages("Auth refused");
        assertThat(out).hasSize(1);
        assertThat(out.get(0)).contains("path=/api/v1/auth/email/verify", "reason=invalid_code")
                .doesNotContain("asha", "123456");
    }

    @Test
    void rateLimitHitIsLoggedOncePerBucketAndAddressWithoutTheAddress() throws Exception {
        for (int i = 0; i < 4; i++) {
            mvc.perform(get("/api/v1/sync/pull").with(from("10.3.0.1"))).andExpect(status().isUnauthorized());
        }
        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/api/v1/sync/pull").with(from("10.3.0.1"))).andExpect(status().isTooManyRequests());
        }
        List<String> out = messages("Rate limit hit");
        assertThat(out).containsExactly("Rate limit hit (bucket=public-ip, path=/api/v1/sync/pull)");
        mvc.perform(get("/api/v1/sync/pull").with(from("10.3.0.2")));
        assertThat(messages("Rate limit hit")).hasSize(1); // the other address is still under its own limit
    }

    @Test
    void perAddressCapIsLoggedWithItsOwnBucketName() throws Exception {
        when(auth.startEmailSignIn(anyString())).thenThrow(new RateLimitedException("email-start-address", 30));
        mvc.perform(post("/api/v1/auth/email/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"asha@example.com\"}")
                        .with(from("10.5.0.1")))
                .andExpect(status().isTooManyRequests());
        assertThat(messages("Rate limit hit"))
                .containsExactly("Rate limit hit (bucket=email-start-address, path=/api/v1/auth/email/start)");
    }

    @Test
    void differentBucketsFromOneAddressEachGetTheirOwnLine() throws Exception {
        when(auth.startEmailSignIn(anyString())).thenThrow(new RateLimitedException("email-start-address", 30));
        when(auth.verifyEmailSignIn(anyString(), anyString())).thenThrow(new RateLimitedException("email-verify-address", 30));
        for (String path : List.of("start", "verify", "start", "verify")) {
            mvc.perform(post("/api/v1/auth/email/" + path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"asha@example.com\",\"code\":\"123456\"}")
                    .with(from("10.5.0.2")));
        }
        assertThat(messages("Rate limit hit")).containsExactlyInAnyOrder(
                "Rate limit hit (bucket=email-start-address, path=/api/v1/auth/email/start)",
                "Rate limit hit (bucket=email-verify-address, path=/api/v1/auth/email/verify)");
    }

    @Test
    void successfulRequestsLogNothing() throws Exception {
        mvc.perform(get("/api/v1/auth/unknown").with(from("10.4.0.1")));
        assertThat(messages("Auth refused")).isEmpty();
        assertThat(messages("Rate limit hit")).isEmpty();
    }
}
