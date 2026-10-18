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
        for (String[] c : new String[][] {{"GET /content/manifest", "/api/v1/content/manifest"},
                {"GET /content/{bundle}", "/api/v1/content/measures"}}) {
            MvcResult r = mvc.perform(get(c[1])).andReturn();
            assertThat(r.getResponse().getStatus()).as(c[0]).isEqualTo(500);
            String body = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
            if (c[0].equals("GET /content/manifest")) {
                ContractSchemas.assertResponse("GET /content/manifest", 500, body);
            } else {
                ContractSchemas.assertResponse("GET /content/{bundle}", 500, body);
            }
        }
    }
}
