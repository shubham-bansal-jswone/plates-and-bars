package app.plateandbar.api.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.SecurityConfig;
import app.plateandbar.api.common.ApiExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.mockito.Mockito;

@WebMvcTest(HealthController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class})
class HealthControllerTest {

    @Autowired MockMvc mvc;
    @MockitoBean JdbcTemplate jdbc;

    @Test
    void healthIsPublicAndMatchesContract() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.version").value("0.1.0"));
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
    void bearerTokenIsNotAcceptedYetUntilAuthLands() throws Exception {
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
