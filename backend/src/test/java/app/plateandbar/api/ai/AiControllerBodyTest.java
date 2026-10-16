package app.plateandbar.api.ai;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.WebMvcAuthSlice;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** H1 on the AI endpoints: what the controller reads, and the global guard, with the service mocked. */
@WebMvcTest(AiController.class)
@WebMvcAuthSlice
class AiControllerBodyTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";

    static final String OTHER = "22222222-2222-2222-2222-222222222222";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean AiQuotaService quotas;
    @MockitoBean AiService ai;

    @Autowired org.springframework.core.env.Environment env;

    @Test
    void multipartIsOffAndAMultipartPostGetsTheContractErrorNotA413() throws Exception {
        org.assertj.core.api.Assertions.assertThat(env.getProperty("spring.servlet.multipart.enabled")).isEqualTo("false");
        mvc.perform(post("/api/v1/ai/describe-meal")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("multipart/form-data; boundary=x")
                        .content("--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\nb\r\n--x--\r\n"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value("invalid_request"));
    }

    /** The mapper no longer fails on trailing content (#81), so /ai/* must still refuse it itself: the body reaches the service as unparseable (null). */
    @Test
    void contentAfterTheJsonBodyIsStillRefused() throws Exception {
        // Its own user: the per-user AI limit is shared by every test in this context.
        when(ai.describeMeal(any(), any())).thenReturn(new tools.jackson.databind.ObjectMapper().createObjectNode());
        for (String bad : new String[] {"{\"text\":\"a\"} junk", "{\"text\":\"a\"}{\"text\":\"b\"}"}) {
            mvc.perform(post("/api/v1/ai/describe-meal")
                            .header("Authorization", "Bearer " + jwt.issue(OTHER).value())
                            .contentType("application/json")
                            .content(bad))
                    .andExpect(status().isOk());
        }
        org.mockito.Mockito.verify(ai, org.mockito.Mockito.times(2))
                .describeMeal(org.mockito.ArgumentMatchers.eq(OTHER), org.mockito.ArgumentMatchers.isNull());
    }

    @Test
    void anOversizedBodyIsPassedOnAsInvalidAndAValidOneIsParsed() throws Exception {
        when(ai.describeMeal(any(), any())).thenReturn(new tools.jackson.databind.ObjectMapper().createObjectNode());
        // Valid JSON, 100 KB: over the 16 KB read bound, under the global limit. It must not be parsed.
        // Valid JSON followed by whitespace, so cutting the read at 16 KB + 1 still leaves parseable JSON: only the
        // length check can reject it.
        byte[] huge = ("{\"text\":\"rice\"}" + " ".repeat(100 * 1024)).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        mvc.perform(post("/api/v1/ai/describe-meal")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("application/json")
                        .content(huge))
                .andExpect(status().isOk()); // the mocked service answers; what matters is what it was given
        org.mockito.Mockito.verify(ai).describeMeal(org.mockito.ArgumentMatchers.eq(USER), org.mockito.ArgumentMatchers.same(AiSchemas.TOO_LARGE));
        // Just under 16 KB of valid JSON is parsed.
        byte[] fits = ("{\"text\":\"" + "a".repeat(16 * 1024 - 20) + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        mvc.perform(post("/api/v1/ai/describe-meal")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("application/json")
                        .content(fits))
                .andExpect(status().isOk());
        org.mockito.Mockito.verify(ai).describeMeal(
                org.mockito.ArgumentMatchers.eq(USER),
                org.mockito.ArgumentMatchers.argThat(b -> b != null && b.path("text").asString().length() == 16 * 1024 - 20));
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
                org.mockito.ArgumentMatchers.argThat(b -> b != null && "rice".equals(b.path("text").asString())));
    }

    @Test
    void aBodyWithANonFiniteNumberIsPassedOnAsUnparseable() throws Exception {
        // #420: 1e400 parses to Infinity, which passes `maximum`; the service gets no body and answers 400.
        when(ai.weeklySummary(any(), any())).thenReturn(new tools.jackson.databind.ObjectMapper().createObjectNode());
        mvc.perform(post("/api/v1/ai/weekly-summary")
                        .header("Authorization", "Bearer " + jwt.issue(USER).value())
                        .contentType("application/json")
                        .content("{\"sessions\":4,\"avg_kcal\":1e400}"))
                .andExpect(status().isOk()); // the mocked service answers; what matters is what it was given
        org.mockito.Mockito.verify(ai).weeklySummary(org.mockito.ArgumentMatchers.eq(USER), org.mockito.ArgumentMatchers.isNull());
    }
}
