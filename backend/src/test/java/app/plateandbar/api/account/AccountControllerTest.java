package app.plateandbar.api.account;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.MutableClock;
import app.plateandbar.api.support.WebMvcAuthSlice;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AccountController.class)
@WebMvcAuthSlice
@Import(AccountControllerTest.Config.class)
@TestPropertySource(properties = {"app.rate-limit.export-per-user.capacity=2", "app.rate-limit.export-per-ip.capacity=3"})
class AccountControllerTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(Instant.parse("2026-10-08T23:59:59Z"));
        }
    }

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper json;
    @MockitoBean AccountService service;

    private String bearer(String user) {
        return "Bearer " + jwt.issue(user).value();
    }

    private org.springframework.test.web.servlet.ResultActions export(String user, String ip) throws Exception {
        return mvc.perform(get("/api/v1/me/export").header("Authorization", bearer(user)).with(r -> {
            r.setRemoteAddr(ip);
            return r;
        }));
    }

    private static String uid() {
        return java.util.UUID.randomUUID().toString(); // buckets live as long as the cached context
    }

    @Test
    void anIpRefusalDoesNotSpendTheUsersOwnAllowance() throws Exception {
        when(service.export(any(), any())).thenReturn(json.createObjectNode());
        String u1 = uid();
        String u2 = uid();
        export(u1, "198.51.100.1").andExpect(status().isOk());
        export(u1, "198.51.100.1").andExpect(status().isOk());
        export(u2, "198.51.100.1").andExpect(status().isOk()); // the IP's 3rd
        export(u2, "198.51.100.1").andExpect(status().isTooManyRequests()); // refused by the IP
        // u2 used one of its two from here; had the refusal spent one it would be out.
        export(u2, "198.51.100.2").andExpect(status().isOk());
        export(u2, "198.51.100.2").andExpect(status().isTooManyRequests()); // now the user cap
    }

    @Test
    void exportSetsHeadersFromTheUtcDateAndUsesTheTokensUser() throws Exception {
        when(service.export(eq(USER), any())).thenReturn(json.createObjectNode().put("format_version", 1));
        export(USER, "198.51.100.10")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string(
                        "Content-Disposition", "attachment; filename=\"plate-and-bar-export-2026-10-08.json\""))
                .andExpect(jsonPath("$.format_version").value(1));
        verify(service).export(eq(USER), eq(Instant.parse("2026-10-08T23:59:59Z")));
    }

    @Test
    void exportIsLimitedPerUserAndTheRefusalDoesNotBuildAnExport() throws Exception {
        String user = java.util.UUID.randomUUID().toString(); // buckets live as long as the cached context
        when(service.export(any(), any())).thenReturn(json.createObjectNode());
        for (int i = 0; i < 2; i++) {
            export(user, "198.51.100.20").andExpect(status().isOk());
        }
        export(user, "198.51.100.20")
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        // Another user is unaffected.
        export(uid(), "198.51.100.21").andExpect(status().isOk());
    }

    @Test
    void deleteIs204AndNeedsAToken() throws Exception {
        mvc.perform(delete("/api/v1/me").header("Authorization", bearer(USER))).andExpect(status().isNoContent());
        verify(service).delete(USER);
    }

    @Test
    void withoutATokenNothingRuns() throws Exception {
        mvc.perform(get("/api/v1/me/export")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/v1/me")).andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }
}
