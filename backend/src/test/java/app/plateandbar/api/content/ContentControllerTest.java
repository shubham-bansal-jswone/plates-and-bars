package app.plateandbar.api.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
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
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@WebMvcTest(ContentController.class)
@WebMvcAuthSlice
class ContentControllerTest {

    static final byte[] MEASURES = "{\"schema_version\":1,\"name\":\"दही\"}\n".getBytes(StandardCharsets.UTF_8);
    static final byte[] CARDS = "{ \"schema_version\": 3 }".getBytes(StandardCharsets.UTF_8);

    @TestConfiguration
    static class Beans {
        @Bean
        ContentBundles contentBundles() {
            return new ContentBundles(
                    ContentBundlesTest.JSON,
                    Map.of("measures", MEASURES, "cards", CARDS),
                    "measures=2026-10-09T08:54:10Z,cards=2026-10-08T14:57:42Z");
        }
    }

    @Autowired MockMvc mvc;
    @Autowired ContentBundles bundles;

    String etag(String name) {
        return bundles.bundle(name).etag();
    }

    @Test
    void manifestIsPublicSortedAndCacheable() throws Exception {
        MvcResult r = mvc.perform(get("/api/v1/content/manifest"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", "public, max-age=300"))
                .andExpect(header().stringValues("Vary", org.hamcrest.Matchers.hasItem("Accept-Encoding")))
                .andExpect(header().string("ETag", bundles.manifest().etag()))
                .andExpect(jsonPath("$.bundles[0].name").value("cards"))
                .andExpect(jsonPath("$.bundles[0].schema_version").value(3))
                .andExpect(jsonPath("$.bundles[0].updated_at").value("2026-10-08T14:57:42Z"))
                .andExpect(jsonPath("$.bundles[1].name").value("measures"))
                .andExpect(jsonPath("$.bundles[1].size_bytes").value(MEASURES.length))
                .andExpect(jsonPath("$.bundles[1].sha256").value(ContentBundles.sha256(MEASURES)))
                .andReturn();
        assertThat(ContentBundles.sha256(r.getResponse().getContentAsByteArray()))
                .isEqualTo(bundles.manifest().etag().replace("\"", ""));
    }

    @Test
    void bundleIsServedByteForByteWithStrongEtag() throws Exception {
        MvcResult r = mvc.perform(get("/api/v1/content/measures"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/json;charset=UTF-8"))
                .andExpect(header().string("Cache-Control", "public, no-cache"))
                .andExpect(header().stringValues("Vary", org.hamcrest.Matchers.hasItem("Accept-Encoding")))
                .andExpect(header().string("ETag", "\"" + ContentBundles.sha256(MEASURES) + "\""))
                .andReturn();
        assertThat(r.getResponse().getContentAsByteArray()).isEqualTo(MEASURES);
    }

    @Test
    void ifNoneMatchVariantsGive304WithEtagCacheControlAndVaryAndNoBody() throws Exception {
        String e = etag("measures");
        String weak = "W/" + e;
        String other = "\"" + "0".repeat(64) + "\"";
        for (String h : new String[] {e, weak, other + ", " + e, other + "," + weak, "*", "  " + e + "  "}) {
            MvcResult r = mvc.perform(get("/api/v1/content/measures").header("If-None-Match", h))
                    .andExpect(status().isNotModified())
                    .andExpect(header().string("ETag", e))
                    .andExpect(header().string("Cache-Control", "public, no-cache"))
                    .andExpect(header().stringValues("Vary", org.hamcrest.Matchers.hasItem("Accept-Encoding")))
                    .andReturn();
            assertThat(r.getResponse().getContentAsByteArray()).as(h).isEmpty();
        }
    }

    @Test
    void manifest304KeepsItsOwnCacheControl() throws Exception {
        mvc.perform(get("/api/v1/content/manifest").header("If-None-Match", bundles.manifest().etag()))
                .andExpect(status().isNotModified())
                .andExpect(header().string("ETag", bundles.manifest().etag()))
                .andExpect(header().string("Cache-Control", "public, max-age=300"))
                .andExpect(header().stringValues("Vary", org.hamcrest.Matchers.hasItem("Accept-Encoding")));
    }

    @Test
    void nonMatchingOverlongOrUnparseableIfNoneMatchIsIgnoredWith200() throws Exception {
        String e = etag("measures");
        String[] headers = {
            "\"" + "1".repeat(64) + "\"",
            e + "x",
            "garbage",
            "W/" + e + ", garbage",
            e.substring(1, e.length() - 1),
            "\"" + "a".repeat(1100) + "\", " + e,
            "**",
            "*, " + e,
        };
        for (String h : headers) {
            assertThat(mvc.perform(get("/api/v1/content/measures").header("If-None-Match", h))
                    .andReturn().getResponse().getStatus()).as(h).isEqualTo(200);
        }
    }

    @Test
    void malformedBundleNameIs400InvalidRequest() throws Exception {
        for (String name : new String[] {"Measures", "1abc", "a_b", "a.b", "-a", "a".repeat(65)}) {
            mvc.perform(get("/api/v1/content/" + name))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("invalid_request"))
                    .andExpect(jsonPath("$.message").value("The request is not valid."))
                    .andExpect(jsonPath("$.details[0].field").value("bundle"));
        }
    }

    @Test
    void wellFormedNameNotInManifestIs404NotFound() throws Exception {
        mvc.perform(get("/api/v1/content/recipes"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("not_found"))
                .andExpect(jsonPath("$.message").value("Not found."));
        // The 64-character limit is inclusive.
        mvc.perform(get("/api/v1/content/" + "a".repeat(64))).andExpect(status().isNotFound());
    }

    @Test
    void tokenIsNotNeededAndOtherMethodsAreRefused() throws Exception {
        mvc.perform(get("/api/v1/content/cards")).andExpect(status().isOk());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/content/cards"))
                .andExpect(status().isMethodNotAllowed());
    }
}
