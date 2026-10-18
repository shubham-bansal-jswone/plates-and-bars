package app.plateandbar.api.account;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.MutableClock;
import app.plateandbar.api.support.WebMvcAuthSlice;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

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

    /** Stubs the stream writer to emit a tiny document, as the real one does through the same stream. */
    private void streamsDocument() throws Exception {
        when(service.writeExport(any(), any(), any())).thenAnswer(inv -> {
            byte[] doc = "{\"format_version\":1}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            inv.<java.io.OutputStream>getArgument(2).write(doc);
            return (long) doc.length;
        });
    }

    /** The body runs on another thread: perform, then dispatch the async result like the container does. */
    private org.springframework.test.web.servlet.ResultActions export(String user, String ip) throws Exception {
        MvcResult started = mvc.perform(get("/api/v1/me/export").header("Authorization", bearer(user)).with(r -> {
                    r.setRemoteAddr(ip);
                    return r;
                }))
                .andReturn();
        if (started.getRequest().isAsyncStarted()) {
            started.getAsyncResult(5000);
            return mvc.perform(asyncDispatch(started));
        }
        return resultActions(started); // refused before streaming: the response is already complete
    }

    private static org.springframework.test.web.servlet.ResultActions resultActions(MvcResult r) {
        return new org.springframework.test.web.servlet.ResultActions() {
            public org.springframework.test.web.servlet.ResultActions andExpect(
                    org.springframework.test.web.servlet.ResultMatcher m) throws Exception {
                m.match(r);
                return this;
            }

            public org.springframework.test.web.servlet.ResultActions andDo(
                    org.springframework.test.web.servlet.ResultHandler h) throws Exception {
                h.handle(r);
                return this;
            }

            public MvcResult andReturn() {
                return r;
            }
        };
    }

    private static String uid() {
        return java.util.UUID.randomUUID().toString(); // buckets live as long as the cached context
    }

    @Test
    void anIpRefusalDoesNotSpendTheUsersOwnAllowance() throws Exception {
        streamsDocument();
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
        streamsDocument();
        export(USER, "198.51.100.10")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string(
                        "Content-Disposition", "attachment; filename=\"plate-and-bar-export-2026-10-08.json\""))
                .andExpect(jsonPath("$.format_version").value(1));
        verify(service).requireAccount(USER);
        verify(service).writeExport(eq(USER), eq(Instant.parse("2026-10-08T23:59:59Z")), any());
    }

    @Test
    void exportIsLimitedPerUserAndTheRefusalDoesNotBuildAnExport() throws Exception {
        String user = java.util.UUID.randomUUID().toString(); // buckets live as long as the cached context
        streamsDocument();
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
    void aMissingAccountIs401BeforeAnyBodyIsStreamed() throws Exception {
        String user = uid();
        doThrow(app.plateandbar.api.common.ApiException.unauthorized()).when(service).requireAccount(user);
        export(user, "198.51.100.30")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("unauthorized"));
        verify(service, never()).writeExport(any(), any(), any());
        // The refusals gave their place back: more of them than the default cap of 2 changes nothing for a good one.
        for (int i = 0; i < 4; i++) {
            String gone = uid();
            doThrow(app.plateandbar.api.common.ApiException.unauthorized()).when(service).requireAccount(gone);
            export(gone, "198.51.100." + (40 + i)).andExpect(status().isUnauthorized());
        }
        String other = uid();
        streamsDocument();
        export(other, "198.51.100.31").andExpect(status().isOk());
    }

    @Test
    void anAsyncDispatchWithoutAnAuthenticatedRequestIsRefused() throws Exception {
        mvc.perform(get("/api/v1/me/export").with(r -> {
                    r.setDispatcherType(jakarta.servlet.DispatcherType.ASYNC);
                    return r;
                }))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }

    @Test
    void deleteIs500InTheErrorSchemaWhenTheLedgerCannotBeWritten() throws Exception {
        doThrow(new ErasureLedgerException("erasure ledger not writable", null)).when(service).delete(USER);
        mvc.perform(delete("/api/v1/me").header("Authorization", bearer(USER)))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("internal"));
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
