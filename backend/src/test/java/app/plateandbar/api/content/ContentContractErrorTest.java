package app.plateandbar.api.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import app.plateandbar.api.support.WebMvcAuthSlice;
import app.plateandbar.api.sync.ContractSchemas;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** The 500 of both {@code /content/*} operations, checked against the contract's {@code Internal} response (#834). */
@WebMvcTest(ContentController.class)
@WebMvcAuthSlice
class ContentContractErrorTest {

    @Autowired MockMvc mvc;
    @MockitoBean ContentBundles bundles;

    @Test
    void anUnexpectedFailureIsTheContractsInternalError() throws Exception {
        when(bundles.manifest()).thenThrow(new IllegalStateException("boom"));
        when(bundles.bundle("measures")).thenThrow(new IllegalStateException("boom"));
        assertInternal("GET /content/manifest", "/api/v1/content/manifest");
        assertInternal("GET /content/{bundle}", "/api/v1/content/measures");
    }

    private void assertInternal(String operation, String url) throws Exception {
        MvcResult r = mvc.perform(get(url)).andReturn();
        assertThat(r.getResponse().getStatus()).as(operation).isEqualTo(500);
        ContractSchemas.assertResponse(operation, 500, r.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
}
