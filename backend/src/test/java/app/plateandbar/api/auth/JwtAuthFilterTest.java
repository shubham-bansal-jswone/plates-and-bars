package app.plateandbar.api.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.health.HealthController;
import app.plateandbar.api.support.WebMvcAuthSlice;
import java.time.Clock;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(HealthController.class)
@WebMvcAuthSlice
class JwtAuthFilterTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean JdbcTemplate jdbc;

    @Test
    void validAccessTokenPassesAuthentication() throws Exception {
        String token = jwt.issue("11111111-1111-1111-1111-111111111111").value();
        // No controller exists for this path; reaching 404 (not 401) proves the filter accepted the token.
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void missingTokenIsUnauthorized() throws Exception {
        mvc.perform(get("/api/v1/sync/pull"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
    }

    @Test
    void garbageTokenIsUnauthorized() throws Exception {
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer not.a.jwt"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
    }

    @Test
    void expiredTokenIsTokenExpired() throws Exception {
        // Issued 16 minutes ago by a service whose clock was in the past, so it expired a minute ago.
        Clock past = Clock.fixed(java.time.Instant.now().minus(Duration.ofMinutes(16)), java.time.ZoneOffset.UTC);
        String token = new JwtService(new AuthProperties(System.getenv("JWT_SIGNING_KEY"), java.util.List.of()), past)
                .issue("11111111-1111-1111-1111-111111111111")
                .value();
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("token_expired"));
    }

    @Test
    void authEndpointsAndHealthAreNotGated() throws Exception {
        // /auth/* has no controller in this slice: 404 (not 401) shows the chain let it through.
        mvc.perform(get("/api/v1/auth/anything")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/health")).andExpect(status().isOk());
    }
}
