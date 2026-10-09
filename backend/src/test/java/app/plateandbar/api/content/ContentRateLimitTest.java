package app.plateandbar.api.content;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.support.WebMvcAuthSlice;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** The public per-IP limit every other public endpoint has applies to /content too. */
@WebMvcTest(ContentController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {"app.rate-limit.public-per-ip.capacity=2", "app.rate-limit.public-per-ip.window=60s"})
class ContentRateLimitTest {

    @TestConfiguration
    static class Beans {
        @Bean
        ContentBundles contentBundles() {
            return new ContentBundles(ContentBundlesTest.JSON,
                    Map.of("cards", "{\"schema_version\":1}".getBytes(StandardCharsets.UTF_8)), "cards=2026-01-01T00:00:00Z");
        }
    }

    @Autowired MockMvc mvc;
    @Autowired app.plateandbar.api.auth.JwtService jwt;

    @Test
    void thirdRequestFromTheSameIpIs429WithRetryAfter() throws Exception {
        mvc.perform(get("/api/v1/content/manifest")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/cards")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/cards"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
    }

    @Test
    void aValidOrGarbageBearerTokenSharesTheSamePerIpBucketAndNeedsNoUserLookup() throws Exception {
        // EveryUserExists would answer for a valid user; the content path never asks, and never uses the per-user bucket.
        String valid = jwt.issue(java.util.UUID.randomUUID().toString()).value();
        java.time.Clock past = java.time.Clock.fixed(
                java.time.Instant.now().minus(java.time.Duration.ofMinutes(16)), java.time.ZoneOffset.UTC);
        String expired = new app.plateandbar.api.auth.JwtService(
                        new app.plateandbar.api.auth.AuthProperties(System.getenv("JWT_SIGNING_KEY"), java.util.List.of()), past)
                .issue("11111111-1111-1111-1111-111111111111")
                .value();
        mvc.perform(get("/api/v1/content/manifest").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }).header("Authorization", "Bearer " + valid)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/cards").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }).header("Authorization", "Bearer " + expired)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/cards").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }).header("Authorization", "Bearer " + valid))
                .andExpect(status().isTooManyRequests());
    }
}
