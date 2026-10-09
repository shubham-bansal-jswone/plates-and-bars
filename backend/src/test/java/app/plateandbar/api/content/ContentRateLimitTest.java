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

    @Test
    void thirdRequestFromTheSameIpIs429WithRetryAfter() throws Exception {
        mvc.perform(get("/api/v1/content/manifest")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/cards")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/cards"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));
    }
}
