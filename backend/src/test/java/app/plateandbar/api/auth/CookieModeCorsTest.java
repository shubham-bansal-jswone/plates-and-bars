package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.support.WebMvcAuthSlice;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** CORS for cookie mode (ADR 006): credentials only for cookie-mode origins, only on /auth/**, exact origins. */
@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {
    "app.auth.cookie-origins=https://app.example.com",
    "app.cors.allowed-origins=https://site.example.com, https://app.example.com"
})
class CookieModeCorsTest {

    @Autowired MockMvc mvc;
    @MockitoBean AuthService auth;

    private ResultActions preflight(String path, String origin, String headers) throws Exception {
        return mvc.perform(options(path)
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", headers));
    }

    @Test
    void aCookieModeOriginsPreflightOnEveryAuthPathAllowsTheHeaderWithCredentials() throws Exception {
        for (String path : List.of("/api/v1/auth/google", "/api/v1/auth/email/verify", "/api/v1/auth/refresh",
                "/api/v1/auth/refresh/revoke", "/api/v1/auth/email/start")) {
            preflight(path, "https://app.example.com", "x-auth-transport,content-type")
                    .andExpect(status().isOk())
                    .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"))
                    .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
                    .andExpect(header().string("Access-Control-Allow-Headers",
                            org.hamcrest.Matchers.containsStringIgnoringCase("X-Auth-Transport")))
                    .andExpect(header().string("Vary", org.hamcrest.Matchers.containsString("Origin")));
        }
    }

    /** Spring answers a preflight with the allowed subset of the requested headers, so the browser is what refuses. */
    private static org.springframework.test.web.servlet.ResultMatcher headerNotAllowed() {
        return result -> {
            String allowed = result.getResponse().getHeader("Access-Control-Allow-Headers");
            assertThat(allowed == null ? "" : allowed.toLowerCase()).doesNotContain("x-auth-transport");
            assertThat(result.getResponse().getHeader("Access-Control-Allow-Credentials")).isNull();
        };
    }

    @Test
    void anotherCorsOriginMayNotSendTheHeaderAndGetsNoCredentialsOnAuthPaths() throws Exception {
        // Allowed headers come back without x-auth-transport, so the browser refuses to send the real request.
        preflight("/api/v1/auth/refresh", "https://site.example.com", "x-auth-transport,content-type")
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://site.example.com"))
                .andExpect(headerNotAllowed());
        // Asking for nothing else, it is refused outright.
        preflight("/api/v1/auth/refresh", "https://site.example.com", "x-auth-transport")
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
        // Without the header its preflight works, and still without credentials.
        preflight("/api/v1/auth/email/start", "https://site.example.com", "content-type")
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://site.example.com"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void anUnknownOriginIsRefusedAndAMatchOnlyIgnoringCaseGetsNoCredentialsOrHeader() throws Exception {
        for (String origin : List.of("https://evil.example.org", "https://app.example.com.evil.org", "http://app.example.com",
                "https://app.example.com:8443")) {
            preflight("/api/v1/auth/refresh", origin, "x-auth-transport,content-type")
                    .andExpect(status().isForbidden())
                    .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))
                    .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
        }
        // Spring's CORS layer compares origins ignoring case; cookie mode does not (CookieModeControllerTest), and this
        // origin never gets credentials or the header.
        preflight("/api/v1/auth/refresh", "https://APP.example.com", "x-auth-transport,content-type")
                .andExpect(headerNotAllowed());
    }

    @Test
    void otherEndpointsStayBearerOnlyEvenForACookieModeOrigin() throws Exception {
        preflight("/api/v1/sync", "https://app.example.com", "authorization,content-type")
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
        preflight("/api/v1/sync", "https://app.example.com", "x-auth-transport")
                .andExpect(status().isForbidden()); // the header is only allowed on /auth/**
        preflight("/api/v1/me", "https://app.example.com", "authorization")
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void theActualResponseToACookieModeOriginCarriesCredentialsAndVaryAndExposesRetryAfter() throws Exception {
        mvc.perform(post("/api/v1/auth/refresh/revoke")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .header("X-Auth-Transport", "cookie")
                        .header("Origin", "https://app.example.com"))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
                .andExpect(header().string("Vary", org.hamcrest.Matchers.containsString("Origin")))
                .andExpect(header().string("Access-Control-Expose-Headers", "Retry-After, ETag"));
    }

    @Test
    void aBodyModeCallFromACorsOnlyOriginGetsNoCredentials() throws Exception {
        mvc.perform(post("/api/v1/auth/refresh/revoke")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"rt_x\"}")
                        .header("Origin", "https://site.example.com"))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://site.example.com"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void aCookieModeRequestFromAnOriginThatIsNotACookieModeOriginIs403ForbiddenJsonNotACorsRefusal() throws Exception {
        // A non-browser caller (or a CORS-only origin whose browser never got past the preflight) sees the Error body.
        for (String origin : List.of("https://site.example.com", "https://evil.example.org")) {
            mvc.perform(post("/api/v1/auth/refresh")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}")
                            .header("X-Auth-Transport", "cookie")
                            .header("Origin", origin))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("forbidden"))
                    .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))
                    .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"))
                    .andExpect(header().doesNotExist("Set-Cookie"));
        }
    }

    @Test
    void cookieModeOriginsMustBeExactNotAWildcardAndBlankEntriesAreIgnored() {
        assertThatThrownBy(() -> new CookieModeProperties(List.of("*"))).isInstanceOf(IllegalStateException.class);
        assertThat(new CookieModeProperties(List.of(" ", " https://a.example "))).extracting(CookieModeProperties::cookieOrigins)
                .isEqualTo(List.of("https://a.example"));
        assertThatThrownBy(() -> new CookieModeProperties(List.of("https://a.example", "null"))).isInstanceOf(IllegalStateException.class);
        assertThat(new CookieModeProperties(null).cookieOrigins()).isEmpty();
    }
}
