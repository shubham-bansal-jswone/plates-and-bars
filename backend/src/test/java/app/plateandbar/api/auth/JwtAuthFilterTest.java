package app.plateandbar.api.auth;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
    @MockitoBean UserExistenceCheck users;

    @org.junit.jupiter.api.BeforeEach
    void usersExist() {
        when(users.exists(org.mockito.ArgumentMatchers.anyString())).thenReturn(true);
    }

    @Test
    void validAccessTokenPassesAuthentication() throws Exception {
        String token = jwt.issue("11111111-1111-1111-1111-111111111111").value();
        // No controller exists for this path; reaching 404 (not 401) proves the filter accepted the token.
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void validTokenOfADeletedUserIsUnauthorizedEverywhereExceptDeleteMe() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";
        when(users.exists(id)).thenReturn(false);
        String token = jwt.issue(id).value();
        mvc.perform(get("/api/v1/sync/pull").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
        mvc.perform(get("/api/v1/me/export").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
        // DELETE /me is exempt (no controller in this slice: 404, not 401, shows the filter let it through).
        mvc.perform(delete("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        // Only that exact method and path: another method on /me is still refused.
        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
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
