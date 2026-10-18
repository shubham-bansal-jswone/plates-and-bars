package app.plateandbar.api.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import app.plateandbar.api.auth.AuthDtos.EmailStartResponse;
import app.plateandbar.api.auth.AuthDtos.TokenPair;
import app.plateandbar.api.auth.AuthDtos.UserDto;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ServiceUnavailableException;
import app.plateandbar.api.support.WebMvcAuthSlice;
import app.plateandbar.api.sync.ContractSchemas;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Every {@code /auth/*} response the contract documents, checked against the contract's schema through
 * {@link ContractSchemas#assertResponse} (#834). The controller's field-by-field tests are {@code AuthControllerTest} and
 * {@code CookieModeControllerTest}; this class is about the shape. Each request comes from its own address so the
 * one-request rate limit here only trips where a test means it to.
 */
@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {
    "app.auth.cookie-origins=https://app.example.com",
    "app.rate-limit.public-per-ip.capacity=1",
    "app.rate-limit.public-per-ip.window=60s",
    "app.rate-limit.email-start-per-ip.capacity=100000"
})
class AuthContractTest {

    static final String ORIGIN = "https://app.example.com";
    static final TokenPair PAIR = new TokenPair(
            "Bearer",
            "access.jwt.value",
            Instant.parse("2026-10-08T06:45:00Z"),
            "rt_abc",
            Instant.parse("2027-01-06T06:30:00Z"),
            new UserDto("11111111-1111-1111-1111-111111111111", "asha@example.com", Instant.parse("2026-10-08T06:30:00Z")),
            true);
    static final String GOOGLE = "/api/v1/auth/google";
    static final String START = "/api/v1/auth/email/start";
    static final String VERIFY = "/api/v1/auth/email/verify";
    static final String REFRESH = "/api/v1/auth/refresh";
    static final String REVOKE = "/api/v1/auth/refresh/revoke";
    static final String G_BODY = "{\"id_token\":\"g-token\"}";
    static final String START_BODY = "{\"email\":\"asha@example.com\"}";
    static final String V_BODY = "{\"email\":\"asha@example.com\",\"code\":\"482913\"}";
    static final String R_BODY = "{\"refresh_token\":\"rt_old\"}";

    private static final AtomicInteger NEXT = new AtomicInteger();

    @Autowired MockMvc mvc;
    @MockitoBean AuthService auth;

    private static MockHttpServletRequestBuilder from(String ip, String path, String body) {
        return post(path).contentType(MediaType.APPLICATION_JSON).content(body).with(r -> {
            r.setRemoteAddr(ip);
            return r;
        });
    }

    private static String freshIp() {
        int n = NEXT.incrementAndGet();
        return "10.20." + (n / 250) + "." + (n % 250 + 1);
    }

    private MvcResult send(String path, String body) throws Exception {
        return mvc.perform(from(freshIp(), path, body)).andReturn();
    }

    private static MockHttpServletRequestBuilder cookieMode(MockHttpServletRequestBuilder b, String origin) {
        b.header("X-Auth-Transport", "cookie");
        return origin == null ? b : b.header("Origin", origin);
    }

    private static void assertResponse(String op, int status, MvcResult r) throws Exception {
        org.assertj.core.api.Assertions.assertThat(r.getResponse().getStatus()).as(op).isEqualTo(status);
        ContractSchemas.assertResponse(op, status, r.getResponse().getContentAsString());
    }

    // ---- POST /auth/google ----

    @Test
    void googleResponses() throws Exception {
        when(auth.signInWithGoogle("g-token")).thenReturn(PAIR);
        ContractSchemas.assertResponse("POST /auth/google", 200, send(GOOGLE, G_BODY).getResponse().getContentAsString());
        // Cookie mode: the body's refresh_token is the empty string and the schema still holds.
        MvcResult cookie = mvc.perform(cookieMode(from(freshIp(), GOOGLE, G_BODY), ORIGIN)).andReturn();
        assertResponse("POST /auth/google", 200, cookie);

        assertResponse("POST /auth/google", 400, send(GOOGLE, "{}"));
        when(auth.signInWithGoogle("bad")).thenThrow(ApiException.unauthorized());
        assertResponse("POST /auth/google", 401, send(GOOGLE, "{\"id_token\":\"bad\"}"));
        assertResponse("POST /auth/google", 403, mvc.perform(cookieMode(from(freshIp(), GOOGLE, G_BODY), "https://evil.example")).andReturn());
        when(auth.signInWithGoogle("boom")).thenThrow(new IllegalStateException("boom"));
        assertResponse("POST /auth/google", 500, send(GOOGLE, "{\"id_token\":\"boom\"}"));
        assertResponse("POST /auth/google", 429, twice(GOOGLE, G_BODY));
    }

    /** The second request from one address, which the one-request bucket refuses. */
    private MvcResult twice(String path, String body) throws Exception {
        String ip = freshIp();
        mvc.perform(from(ip, path, body));
        return mvc.perform(from(ip, path, body)).andReturn();
    }

    // ---- POST /auth/email/start ----

    @Test
    void emailStartResponses() throws Exception {
        when(auth.startEmailSignIn("asha@example.com"))
                .thenReturn(new EmailStartResponse(Instant.parse("2026-10-08T06:40:00Z"), 60));
        assertResponse("POST /auth/email/start", 202, send(START, START_BODY));
        assertResponse("POST /auth/email/start", 400, send(START, "{\"email\":\"nope\"}"));
        when(auth.startEmailSignIn("boom@example.com")).thenThrow(new IllegalStateException("boom"));
        assertResponse("POST /auth/email/start", 500, send(START, "{\"email\":\"boom@example.com\"}"));
        assertResponse("POST /auth/email/start", 429, twice(START, START_BODY));
    }

    // ---- POST /auth/email/verify ----

    @Test
    void emailVerifyResponses() throws Exception {
        when(auth.verifyEmailSignIn("asha@example.com", "482913")).thenReturn(PAIR);
        assertResponse("POST /auth/email/verify", 200, send(VERIFY, V_BODY));
        assertResponse("POST /auth/email/verify", 400, send(VERIFY, "{\"email\":\"asha@example.com\",\"code\":\"12\"}"));
        when(auth.verifyEmailSignIn("asha@example.com", "000000")).thenThrow(ApiException.invalidCode());
        assertResponse("POST /auth/email/verify", 401, send(VERIFY, "{\"email\":\"asha@example.com\",\"code\":\"000000\"}"));
        assertResponse("POST /auth/email/verify", 403, mvc.perform(cookieMode(from(freshIp(), VERIFY, V_BODY), null)).andReturn());
        when(auth.verifyEmailSignIn("asha@example.com", "999999")).thenThrow(new IllegalStateException("boom"));
        assertResponse("POST /auth/email/verify", 500, send(VERIFY, "{\"email\":\"asha@example.com\",\"code\":\"999999\"}"));
        assertResponse("POST /auth/email/verify", 429, twice(VERIFY, V_BODY));
    }

    // ---- POST /auth/refresh ----

    @Test
    void refreshResponses() throws Exception {
        when(auth.refresh("rt_old")).thenReturn(PAIR);
        assertResponse("POST /auth/refresh", 200, send(REFRESH, R_BODY));
        MvcResult cookie = mvc.perform(cookieMode(from(freshIp(), REFRESH, "{}"), ORIGIN)
                .cookie(new Cookie("__Secure-pb_refresh", "rt_old"))).andReturn();
        assertResponse("POST /auth/refresh", 200, cookie);

        assertResponse("POST /auth/refresh", 400, send(REFRESH, "{}"));
        when(auth.refresh("rt_bad")).thenThrow(ApiException.sessionEnded());
        assertResponse("POST /auth/refresh", 401, send(REFRESH, "{\"refresh_token\":\"rt_bad\"}"));
        assertResponse("POST /auth/refresh", 403, mvc.perform(cookieMode(from(freshIp(), REFRESH, "{}"), null)).andReturn());
        when(auth.refresh("rt_boom")).thenThrow(new IllegalStateException("boom"));
        assertResponse("POST /auth/refresh", 500, send(REFRESH, "{\"refresh_token\":\"rt_boom\"}"));
        when(auth.refresh("rt_lock")).thenThrow(new ServiceUnavailableException(new CannotAcquireLockException("lock")));
        assertResponse("POST /auth/refresh", 503, send(REFRESH, "{\"refresh_token\":\"rt_lock\"}"));
        assertResponse("POST /auth/refresh", 429, twice(REFRESH, R_BODY));
    }

    // ---- POST /auth/refresh/revoke ----

    @Test
    void revokeResponses() throws Exception {
        assertResponse("POST /auth/refresh/revoke", 204, send(REVOKE, R_BODY));
        assertResponse("POST /auth/refresh/revoke", 400, send(REVOKE, "{}"));
        assertResponse("POST /auth/refresh/revoke", 403, mvc.perform(cookieMode(from(freshIp(), REVOKE, "{}"), null)).andReturn());
        doThrow(new IllegalStateException("boom")).when(auth).revokeSession("rt_boom");
        assertResponse("POST /auth/refresh/revoke", 500, send(REVOKE, "{\"refresh_token\":\"rt_boom\"}"));
        doThrow(new ServiceUnavailableException(new CannotAcquireLockException("lock"))).when(auth).revokeSession("rt_lock");
        assertResponse("POST /auth/refresh/revoke", 503, send(REVOKE, "{\"refresh_token\":\"rt_lock\"}"));
        assertResponse("POST /auth/refresh/revoke", 429, twice(REVOKE, R_BODY));
    }
}
