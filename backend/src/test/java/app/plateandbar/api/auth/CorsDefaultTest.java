package app.plateandbar.api.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.health.HealthController;
import app.plateandbar.api.support.WebMvcAuthSlice;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** With no CORS_ALLOWED_ORIGINS set, no browser origin is allowed. */
@WebMvcTest(HealthController.class)
@WebMvcAuthSlice
class CorsDefaultTest {

    @Autowired MockMvc mvc;
    @MockitoBean JdbcTemplate jdbc;

    @Test
    void noConfiguredOriginsMeansEveryCrossOriginPreflightIsRejected() throws Exception {
        mvc.perform(options("/api/v1/sync")
                        .header("Origin", "https://app.example.com")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }
}
