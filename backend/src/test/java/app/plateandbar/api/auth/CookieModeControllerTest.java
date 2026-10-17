package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.AuthDtos.TokenPair;
import app.plateandbar.api.auth.AuthDtos.UserDto;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ServiceUnavailableException;
import app.plateandbar.api.support.WebMvcAuthSlice;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Cookie mode (#250, ADR 006, contract 0.1.17) at the controller: the cookie, the body, the Origin check and the order of
 * the checks, with a mocked {@link AuthService}. Body mode is covered by {@link AuthControllerTest} and stays unchanged.
 */
@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {
    "app.auth.cookie-origins=https://app.example.com",
    // A CORS-only origin: the website's account-deletion page, never a cookie-mode origin.
    "app.cors.allowed-origins=https://site.example.com",
    "app.sync.max-body-bytes=1000"
})
class CookieModeControllerTest {

    static final String ORIGIN = "https://app.example.com";
    static final String NAME = "__Secure-pb_refresh";
    static final List<String> ENDPOINTS = List.of("/google", "/email/verify", "/refresh", "/refresh/revoke");

    @Autowired MockMvc mvc;
    @MockitoBean AuthService auth;

    private static final TokenPair PAIR = new TokenPair(
            "Bearer",
            "access.jwt.value",
            Instant.parse("2026-10-08T06:45:00Z"),
            "rt_abc",
            Instant.parse("2027-01-06T06:30:00Z"),
            new UserDto("11111111-1111-1111-1111-111111111111", "asha@example.com", Instant.parse("2026-10-08T06:30:00Z")),
            true);

    private static String bodyFor(String endpoint) {
        return switch (endpoint) {
            case "/google" -> "{\"id_token\":\"g-token\"}";
            case "/email/verify" -> "{\"email\":\"asha@example.com\",\"code\":\"123456\"}";
            default -> "{}";
        };
    }

    private static MockHttpServletRequestBuilder json(String endpoint, String body) {
        return post("/api/v1/auth" + endpoint).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    /** A cookie-mode request from the web app's origin. */
    private static MockHttpServletRequestBuilder cookieMode(String endpoint, String body) {
        return json(endpoint, body).header("X-Auth-Transport", "cookie").header("Origin", ORIGIN);
    }

    private static MockHttpServletRequestBuilder withCookie(MockHttpServletRequestBuilder b, String token) {
        return b.cookie(new Cookie("__Secure-pb_refresh", token));
    }

    /**
     * The one refresh cookie in the response, with exactly the contract's attributes. MockMvc re-renders {@code Set-Cookie}
     * from the cookie it parsed, so the attributes are read from it; {@code AuthCookieIT} checks the real header text.
     */
    private static ResultMatcher refreshCookie(String value, int maxAge) {
        return result -> {
            MockHttpServletResponse res = result.getResponse();
            assertThat(res.getHeaders("Set-Cookie")).hasSize(1);
            Cookie c = res.getCookie(NAME);
            assertThat(c).isNotNull();
            assertThat(c.getValue()).isEqualTo(value);
            assertThat(c.getPath()).isEqualTo("/api/v1/auth/refresh");
            assertThat(c.getMaxAge()).isEqualTo(maxAge);
            assertThat(c.isHttpOnly()).isTrue();
            assertThat(c.getSecure()).isTrue();
            assertThat(c.getAttribute("SameSite")).isEqualTo("Strict");
            assertThat(c.getDomain()).isNull();
        };
    }

    private static ResultMatcher setCookie(String token) {
        return refreshCookie(token, 7776000);
    }

    /** Cleared: same name, path and attributes, empty value, {@code Max-Age=0}. */
    private static ResultMatcher cleared() {
        return refreshCookie("", 0);
    }

    // ---- the cookie on 200 ----

    @Test
    void signInsAndRefreshSetTheCookieWithExactlyTheContractAttributesAndAnEmptyBodyToken() throws Exception {
        when(auth.signInWithGoogle("g-token")).thenReturn(PAIR);
        when(auth.verifyEmailSignIn("asha@example.com", "123456")).thenReturn(PAIR);
        when(auth.refresh("rt_old")).thenReturn(PAIR);

        for (ResultActions r : new ResultActions[] {
            mvc.perform(cookieMode("/google", bodyFor("/google"))),
            mvc.perform(cookieMode("/email/verify", bodyFor("/email/verify"))),
            mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_old"))
        }) {
            r.andExpect(status().isOk())
                    .andExpect(setCookie("rt_abc"))
                    .andExpect(jsonPath("$.refresh_token").value(""))
                    .andExpect(jsonPath("$.access_token").value("access.jwt.value"))
                    .andExpect(jsonPath("$.refresh_token_expires_at").value("2027-01-06T06:30:00Z"))
                    .andExpect(jsonPath("$.user.email").value("asha@example.com"))
                    .andExpect(jsonPath("$.new_user").value(true));
        }
    }

    @Test
    void theCookieCarriesTheRotatedTokenNotTheOldOne() throws Exception {
        TokenPair rotated = new TokenPair("Bearer", "a2", PAIR.accessTokenExpiresAt(), "rt_rotated",
                PAIR.refreshTokenExpiresAt(), PAIR.user(), false);
        when(auth.refresh("rt_old")).thenReturn(rotated);
        mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_old"))
                .andExpect(setCookie("rt_rotated"));
    }

    @Test
    void theCookieLifetimeIsTheNinetyDayRefreshLifetime() {
        assertThat(AuthService.REFRESH_TTL.toSeconds()).isEqualTo(7776000);
    }

    // ---- the token comes from the cookie only ----

    @Test
    void refreshReadsTheTokenFromTheCookie() throws Exception {
        when(auth.refresh("rt_cookie")).thenReturn(PAIR);
        mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_cookie")).andExpect(status().isOk());
        verify(auth).refresh("rt_cookie");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{\"refresh_token\":\"rt_body\"}", "{\"refresh_token\":\"\"}", "{\"refresh_token\":null}", "{\"refresh_token\":\"  \"}"
    })
    void aBodyTokenIs400WhateverItsValueEvenWithAValidCookieAndNothingIsReadOrChanged(String body) throws Exception {
        for (String endpoint : List.of("/refresh", "/refresh/revoke")) {
            mvc.perform(withCookie(cookieMode(endpoint, body), "rt_cookie"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_request"))
                    .andExpect(header().doesNotExist("Set-Cookie"));
        }
        verifyNoInteractions(auth);
    }

    @Test
    void aMissingBodyIs400AndLeavesTheCookie() throws Exception {
        mvc.perform(withCookie(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .header("X-Auth-Transport", "cookie").header("Origin", ORIGIN), "rt_cookie"))
                .andExpect(status().isBadRequest())
                .andExpect(header().doesNotExist("Set-Cookie"));
        verifyNoInteractions(auth);
    }

    // ---- the cookie is cleared by every refresh 401, and only by those ----

    @Test
    void everyRefreshUnauthorizedClearsTheCookieIncludingNoCookieAtAll() throws Exception {
        when(auth.refresh("rt_dead")).thenThrow(ApiException.sessionEnded());
        mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_dead"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"))
                .andExpect(cleared());
        mvc.perform(cookieMode("/refresh", "{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"))
                .andExpect(cleared());
        mvc.perform(withCookie(cookieMode("/refresh", "{}"), "  "))
                .andExpect(status().isUnauthorized())
                .andExpect(cleared());
        verify(auth).refresh("rt_dead");
    }

    @Test
    void unavailableAndOtherErrorsLeaveTheCookieAlone() throws Exception {
        when(auth.refresh("rt_busy")).thenThrow(new ServiceUnavailableException(new RuntimeException("lock")));
        mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_busy"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("unavailable"))
                .andExpect(header().doesNotExist("Set-Cookie"));
        when(auth.refresh("rt_boom")).thenThrow(new IllegalStateException("x"));
        mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_boom"))
                .andExpect(status().isInternalServerError())
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    @Test
    void aSignInRefusalDoesNotTouchTheCookie() throws Exception {
        when(auth.signInWithGoogle(any())).thenThrow(ApiException.unauthorized());
        mvc.perform(cookieMode("/google", bodyFor("/google")))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    // ---- without the header nothing changes ----

    @Test
    void withoutTheHeaderTheCookieIsIgnoredAndNoCookieIsSet() throws Exception {
        when(auth.refresh("rt_body")).thenReturn(PAIR);
        when(auth.signInWithGoogle("g-token")).thenReturn(PAIR);

        // The body token is used even though the browser also sent a (different) cookie; no Origin needed.
        mvc.perform(withCookie(json("/refresh", "{\"refresh_token\":\"rt_body\"}"), "rt_cookie"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andExpect(jsonPath("$.refresh_token").value("rt_abc"));
        verify(auth).refresh("rt_body");

        // A cookie alone is not a token.
        mvc.perform(withCookie(json("/refresh", "{}"), "rt_cookie")).andExpect(status().isBadRequest());
        mvc.perform(json("/google", bodyFor("/google")))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andExpect(jsonPath("$.refresh_token").value("rt_abc"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Cookie", "COOKIE", "body", "cookie ", " cookie", "cookies", "", "true"})
    void anyOtherHeaderValueIsBodyModeSoNoOriginIsNeededAndNothingIsSet(String value) throws Exception {
        when(auth.refresh("rt_body")).thenReturn(PAIR);
        mvc.perform(withCookie(json("/refresh", "{\"refresh_token\":\"rt_body\"}"), "rt_cookie")
                        .header("X-Auth-Transport", value))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andExpect(jsonPath("$.refresh_token").value("rt_abc"));
        verify(auth).refresh("rt_body");
    }

    @Test
    void theHeaderIsIgnoredOnEmailStart() throws Exception {
        mvc.perform(json("/email/start", "{\"email\":\"asha@example.com\"}").header("X-Auth-Transport", "cookie"))
                .andExpect(status().isAccepted());
    }

    // ---- revoke ----

    @Test
    void revokeInCookieModeRevokesTheCookiesTokenAndClearsTheCookie() throws Exception {
        mvc.perform(withCookie(cookieMode("/refresh/revoke", "{}"), "rt_cookie"))
                .andExpect(status().isNoContent())
                .andExpect(cleared());
        verify(auth).revokeSession("rt_cookie");
    }

    @Test
    void revokeWithoutACookieIsStill204ClearsTheCookieAndRevokesNothing() throws Exception {
        mvc.perform(cookieMode("/refresh/revoke", "{}"))
                .andExpect(status().isNoContent())
                .andExpect(cleared());
        verifyNoInteractions(auth);
    }

    @Test
    void revokeInBodyModeUsesTheBodyTokenAndSetsNoCookie() throws Exception {
        mvc.perform(withCookie(json("/refresh/revoke", "{\"refresh_token\":\"rt_body\"}"), "rt_cookie"))
                .andExpect(status().isNoContent())
                .andExpect(header().doesNotExist("Set-Cookie"));
        verify(auth).revokeSession("rt_body");
    }

    @Test
    void revokeInBodyModeNeedsABodyToken() throws Exception {
        for (String body : List.of("{}", "{\"refresh_token\":\"\"}", "{\"refresh_token\":null}")) {
            mvc.perform(json("/refresh/revoke", body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_request"));
        }
        verifyNoInteractions(auth);
    }

    @Test
    void revokeIsPublic() throws Exception {
        // No bearer token anywhere above; a garbage one does not matter either.
        mvc.perform(json("/refresh/revoke", "{\"refresh_token\":\"rt_x\"}").header("Authorization", "Bearer garbage"))
                .andExpect(status().isNoContent());
    }

    // ---- CSRF: Origin ----

    @Test
    void aMissingOrWrongOriginIs403ForbiddenOnAllFourEndpointsWithNothingReadOrChanged() throws Exception {
        for (String endpoint : ENDPOINTS) {
            for (String origin : new String[] {
                null,
                "https://evil.example.org",
                "https://site.example.com", // a CORS origin that is not a cookie-mode origin
                "https://APP.example.com", // exact match, case-sensitive
                "https://app.example.com/", // trailing slash
                "http://app.example.com",
                "https://app.example.com:8443",
                "https://app.example.com.evil.org",
                "null",
                ""
            }) {
                MockHttpServletRequestBuilder b =
                        withCookie(json(endpoint, bodyFor(endpoint)).header("X-Auth-Transport", "cookie"), "rt_cookie");
                if (origin != null) {
                    b.header("Origin", origin);
                }
                mvc.perform(b)
                        .andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.code").value("forbidden"))
                        .andExpect(jsonPath("$.message").value("This request is not allowed from here."))
                        .andExpect(header().doesNotExist("Set-Cookie"));
            }
        }
        verifyNoInteractions(auth);
    }

    @Test
    void aPercentEncodedPathCannotSlipPastTheOriginCheck() throws Exception {
        // The router decodes the path, so this reaches /auth/refresh and /auth/refresh/revoke.
        for (String path : List.of("/api/v1/auth/%72efresh", "/api/v1/auth/refresh/%72evoke", "/api/v1/auth/%67oogle")) {
            mvc.perform(post(new java.net.URI(path)).contentType(MediaType.APPLICATION_JSON).content("{\"id_token\":\"x\"}")
                            .header("X-Auth-Transport", "cookie").header("Origin", "https://evil.example.org"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("forbidden"));
        }
        verifyNoInteractions(auth);
    }

    @Test
    void theOriginIsCheckedBeforeValidationSo403BeatsAnInvalidBody() throws Exception {
        for (String endpoint : ENDPOINTS) {
            mvc.perform(json(endpoint, "not json").header("X-Auth-Transport", "cookie").header("Origin", "https://evil.example.org"))
                    .andExpect(status().isForbidden());
            // With the right Origin the same body is a plain 400.
            mvc.perform(json(endpoint, "not json").header("X-Auth-Transport", "cookie").header("Origin", ORIGIN))
                    .andExpect(status().isBadRequest());
        }
        // A body token in cookie mode is a validation error too: the Origin comes first.
        mvc.perform(json("/refresh", "{\"refresh_token\":\"rt\"}").header("X-Auth-Transport", "cookie"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(auth);
    }

    @Test
    void theBodySizeLimitIsCheckedBeforeTheOrigin() throws Exception {
        mvc.perform(json("/refresh", "{\"x\":\"" + "a".repeat(1100) + "\"}")
                        .header("X-Auth-Transport", "cookie").header("Origin", "https://evil.example.org"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.details[0].issue").value("too_large"));
    }

    @Test
    void bodyModeNeedsNoOrigin() throws Exception {
        when(auth.signInWithGoogle("g-token")).thenReturn(PAIR);
        mvc.perform(json("/google", bodyFor("/google"))).andExpect(status().isOk());
        mvc.perform(json("/google", bodyFor("/google")).header("Origin", "https://evil.example.org"))
                .andExpect(status().isForbidden()); // CORS refuses a foreign origin before this app's code runs
    }

    @Test
    void theTokenIsNeverInAnyResponseBodyInCookieMode() throws Exception {
        when(auth.refresh("rt_cookie")).thenReturn(PAIR);
        String body = mvc.perform(withCookie(cookieMode("/refresh", "{}"), "rt_cookie"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("rt_abc").doesNotContain("rt_cookie");
    }
}
