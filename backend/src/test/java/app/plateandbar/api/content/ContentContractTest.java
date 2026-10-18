package app.plateandbar.api.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import app.plateandbar.api.support.WebMvcAuthSlice;
import app.plateandbar.api.sync.ContractSchemas;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Every {@code /content/*} response the contract documents, checked against the contract's schema through
 * {@link ContractSchemas#assertResponse} (#834). {@code ContentControllerTest} checks the fields and headers.
 */
@WebMvcTest(ContentController.class)
@WebMvcAuthSlice
@TestPropertySource(properties = {"app.rate-limit.public-per-ip.capacity=1", "app.rate-limit.public-per-ip.window=60s"})
class ContentContractTest {

    @TestConfiguration
    static class Beans {
        @Bean
        ContentBundles contentBundles() {
            return new ContentBundles(ContentBundlesTest.JSON,
                    Map.of("measures", "{\"schema_version\":1,\"name\":\"x\"}\n".getBytes(StandardCharsets.UTF_8)),
                    "measures=2026-10-09T08:54:10Z");
        }
    }

    private static int next;

    @Autowired MockMvc mvc;
    @Autowired ContentBundles bundles;

    /** A request from an address of its own, so the one-request bucket never trips by accident. */
    private MockHttpServletRequestBuilder from(String path) {
        String ip = "10.30.0." + (++next);
        return get(path).with(r -> {
            r.setRemoteAddr(ip);
            return r;
        });
    }

    private void assertResponse(String op, int status, MockHttpServletRequestBuilder req) throws Exception {
        MvcResult r = mvc.perform(req).andReturn();
        assertThat(r.getResponse().getStatus()).as(op).isEqualTo(status);
        ContractSchemas.assertResponse(op, status, r.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    @Test
    void manifestResponses() throws Exception {
        assertResponse("GET /content/manifest", 200, from("/api/v1/content/manifest"));
        assertResponse("GET /content/manifest", 304,
                from("/api/v1/content/manifest").header("If-None-Match", bundles.manifest().etag()));
        String ip = "10.31.0.1";
        mvc.perform(get("/api/v1/content/manifest").with(r -> { r.setRemoteAddr(ip); return r; }));
        assertResponse("GET /content/manifest", 429,
                get("/api/v1/content/manifest").with(r -> { r.setRemoteAddr(ip); return r; }));
    }

    @Test
    void bundleResponses() throws Exception {
        assertResponse("GET /content/{bundle}", 200, from("/api/v1/content/measures"));
        assertResponse("GET /content/{bundle}", 304,
                from("/api/v1/content/measures").header("If-None-Match", bundles.bundle("measures").etag()));
        assertResponse("GET /content/{bundle}", 400, from("/api/v1/content/Bad_Name"));
        assertResponse("GET /content/{bundle}", 404, from("/api/v1/content/recipes"));
        String ip = "10.31.0.2";
        mvc.perform(get("/api/v1/content/measures").with(r -> { r.setRemoteAddr(ip); return r; }));
        assertResponse("GET /content/{bundle}", 429,
                get("/api/v1/content/measures").with(r -> { r.setRemoteAddr(ip); return r; }));
    }
}
