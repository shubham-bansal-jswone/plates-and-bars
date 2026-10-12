package app.plateandbar.api.ai;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.WebMvcAuthSlice;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AiController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = "app.rate-limit.ai-per-ip.capacity=2")
class AiControllerTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";
    static final AiQuota QUOTA = new AiQuota(10, 7, Instant.parse("2026-10-10T00:00:00Z"));

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean AiQuotaService quotas;
    @MockitoBean AiService ai;

    private org.springframework.test.web.servlet.ResultActions callStatus(String ip) throws Exception {
        return mvc.perform(get("/api/v1/ai/status")
                .header("Authorization", "Bearer " + jwt.issue(USER).value())
                .with(r -> {
                    r.setRemoteAddr(ip);
                    return r;
                }));
    }

    @Test
    void reportsFeaturesAndQuotaInTheContractShape() throws Exception {
        when(quotas.features()).thenReturn(java.util.Map.of(
                AiFeature.DESCRIBE_MEAL, false, AiFeature.ASK_WHY, true, AiFeature.WEEKLY_SUMMARY, false));
        when(quotas.quota(USER)).thenReturn(QUOTA);
        callStatus("198.51.100.1")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.features.describe_meal").value(false))
                .andExpect(jsonPath("$.features.ask_why").value(true))
                .andExpect(jsonPath("$.features.weekly_summary").value(false))
                .andExpect(jsonPath("$.quota.limit").value(10))
                .andExpect(jsonPath("$.quota.remaining").value(7))
                .andExpect(jsonPath("$.quota.resets_at").value("2026-10-10T00:00:00Z"));
    }

    @Test
    void needsAToken() throws Exception {
        mvc.perform(get("/api/v1/ai/status")).andExpect(status().isUnauthorized());
    }

    @Test
    void isLimitedPerIpWith429AndRetryAfter() throws Exception {
        when(quotas.quota(any())).thenReturn(QUOTA);
        when(quotas.features()).thenReturn(java.util.Map.of(
                AiFeature.DESCRIBE_MEAL, false, AiFeature.ASK_WHY, false, AiFeature.WEEKLY_SUMMARY, false));
        callStatus("198.51.100.2").andExpect(status().isOk());
        callStatus("198.51.100.2").andExpect(status().isOk());
        callStatus("198.51.100.2")
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
        callStatus("198.51.100.3").andExpect(status().isOk());
    }

    @Test
    void anOversizedBodyIsPassedOnAsInvalidAndAValidOneIsParsed() throws Exception {
        when(ai.describeMeal(any(), any())).thenReturn(new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode());
        byte[] huge = new byte[100 * 1024]; // over the 16 KB read bound, under the global limit
        java.util.Arrays.fill(huge, (byte) 'a');
        mvc.perform(post("/api/v1/ai/describe-meal")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("application/json")
                        .content(huge))
                .andExpect(status().isOk()); // the mocked service answers; what matters is what it was given
        org.mockito.Mockito.verify(ai).describeMeal(org.mockito.ArgumentMatchers.eq(USER), org.mockito.ArgumentMatchers.isNull());
        // Over the global request limit (2 MB): refused by the guard filter before the controller runs.
        mvc.perform(post("/api/v1/ai/describe-meal")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("application/json")
                        .content(new byte[3 * 1024 * 1024]))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.details[0].issue").value("too_large"));
        mvc.perform(post("/api/v1/ai/describe-meal")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("application/json")
                        .content("{\"text\":\"rice\"}"))
                .andExpect(status().isOk());
        org.mockito.Mockito.verify(ai).describeMeal(
                org.mockito.ArgumentMatchers.eq(USER),
                org.mockito.ArgumentMatchers.argThat(b -> b != null && "rice".equals(b.path("text").asText())));
    }
}
