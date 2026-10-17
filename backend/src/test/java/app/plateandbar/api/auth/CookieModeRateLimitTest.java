package app.plateandbar.api.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.support.WebMvcAuthSlice;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Order of checks in cookie mode: the per-IP rate limit (429) comes before the Origin check (403). */
@WebMvcTest(AuthController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {
    "app.auth.cookie-origins=https://app.example.com",
    "app.rate-limit.public-per-ip.capacity=2",
    "app.rate-limit.public-per-ip.window=60s"
})
class CookieModeRateLimitTest {

    @Autowired MockMvc mvc;
    @MockitoBean AuthService auth;

    private org.springframework.test.web.servlet.ResultActions revoke(String origin) throws Exception {
        var b = post("/api/v1/auth/refresh/revoke").contentType(MediaType.APPLICATION_JSON).content("{}")
                .header("X-Auth-Transport", "cookie");
        if (origin != null) {
            b.header("Origin", origin);
        }
        return mvc.perform(b);
    }

    @Test
    void revokeIsRateLimitedPerIpAnd429BeatsTheOriginCheck() throws Exception {
        revoke("https://app.example.com").andExpect(status().isNoContent());
        revoke(null).andExpect(status().isForbidden()); // the second request of the bucket: Origin refuses it
        revoke(null)
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        revoke("https://app.example.com")
                .andExpect(status().isTooManyRequests())
                .andExpect(header().doesNotExist("Set-Cookie"));
    }
}
