package app.plateandbar.api.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.common.CorsProperties;
import app.plateandbar.api.health.HealthController;
import app.plateandbar.api.support.WebMvcAuthSlice;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@WebMvcTest(HealthController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = "app.cors.allowed-origins=https://app.example.com, https://staging.example.com")
class CorsTest {

    @Autowired MockMvc mvc;
    @MockitoBean JdbcTemplate jdbc;

    private org.springframework.test.web.servlet.ResultActions preflight(String origin) throws Exception {
        return mvc.perform(options("/api/v1/sync")
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "authorization,content-type"));
    }

    @Test
    void preflightFromAConfiguredOriginIsAllowedWithoutCredentials() throws Exception {
        preflight("https://app.example.com")
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"))
                .andExpect(header().string("Access-Control-Allow-Methods", org.hamcrest.Matchers.containsString("POST")))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
        preflight("https://staging.example.com").andExpect(status().isOk());
    }

    @Test
    void preflightFromAnyOtherOriginIsRejected() throws Exception {
        preflight("https://evil.example.org").andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        // A look-alike prefix or a different scheme or port is a different origin.
        preflight("https://app.example.com.evil.org").andExpect(status().isForbidden());
        preflight("http://app.example.com").andExpect(status().isForbidden());
    }

    @Test
    void preflightWithADisallowedHeaderIsRejected() throws Exception {
        mvc.perform(options("/api/v1/sync")
                        .header("Origin", "https://app.example.com")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "x-custom"))
                .andExpect(status().isForbidden());
    }

    @Test
    void simpleRequestFromAnotherOriginGetsNoCorsHeaders() throws Exception {
        mvc.perform(get("/api/v1/health").header("Origin", "https://evil.example.org"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        mvc.perform(get("/api/v1/health").header("Origin", "https://app.example.com"))
                .andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"));
    }

    @Test
    void wildcardOriginIsRefusedAtStartupAndBlankEntriesAreIgnored() {
        assertThatThrownBy(() -> new CorsProperties(List.of("*"))).isInstanceOf(IllegalStateException.class);
        assertThat(new CorsProperties(List.of(" ", "https://a.example"))).extracting(CorsProperties::allowedOrigins)
                .isEqualTo(List.of("https://a.example"));
    }
}
