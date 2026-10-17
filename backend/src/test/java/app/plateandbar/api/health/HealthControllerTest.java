package app.plateandbar.api.health;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.support.WebMvcAuthSlice;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.mockito.Mockito;

@WebMvcTest(HealthController.class)
@WebMvcAuthSlice
class HealthControllerTest {

    @Autowired MockMvc mvc;
    @MockitoBean JdbcTemplate jdbc;
    @Value("${server.forward-headers-strategy}") String forwardHeadersStrategy;

    @Test
    void forwardedHeadersAreNotTrustedByTheContainer() {
        assertEquals("none", forwardHeadersStrategy);
    }

    @Test
    void appEmitsNoHstsItself() throws Exception {
        // HSTS is the proxy's job (infra/caddy/Caddyfile.api); the app sends none. The property test above is the spoofing guard.
        mvc.perform(get("/api/v1/health").header("X-Forwarded-Proto", "https").header("X-Forwarded-For", "203.0.113.9"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Strict-Transport-Security"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }

    @Test
    void healthIsPublicAndMatchesContract() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"ok\"}", JsonCompareMode.STRICT));
    }

    @Test
    void databaseDownIs503UnavailableErrorShape() throws Exception {
        Mockito.when(jdbc.queryForObject("SELECT 1", Integer.class))
                .thenThrow(new CannotGetJdbcConnectionException("db down"));
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("unavailable"))
                .andExpect(jsonPath("$.message").value("Service temporarily unavailable."));
    }

    @Test
    void otherRoutesWithoutTokenAre401UnauthorizedErrorShape() throws Exception {
        mvc.perform(get("/api/v1/foods/search"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"))
                .andExpect(jsonPath("$.message").exists());
    }

    @Test
    void malformedBearerTokenIs401Unauthorized() throws Exception {
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer abc"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
    }

    @Test
    void unacceptableAcceptHeaderIs406WithErrorBody() throws Exception {
        mvc.perform(get("/api/v1/health").accept(org.springframework.http.MediaType.APPLICATION_XML))
                .andExpect(status().isNotAcceptable())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").exists());
    }
}
