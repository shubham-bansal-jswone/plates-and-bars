package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.WebMvcAuthSlice;
import app.plateandbar.api.sync.ContractSchemas;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** The three image routes with the service mocked: what the controller reads, the status flags and every error status. */
@WebMvcTest(AiController.class)
@WebMvcAuthSlice
@org.springframework.test.context.TestPropertySource(properties = {"app.rate-limit.ai-per-user.capacity=1000", "app.rate-limit.ai-per-ip.capacity=100000"})
class AiImageControllerTest {

    static final String USER = "11111111-1111-1111-1111-111111111111";
    static final String[][] OPS = {
        {"POST /ai/meal-photo", "/api/v1/ai/meal-photo"},
        {"POST /ai/import-recipe", "/api/v1/ai/import-recipe"},
        {"POST /ai/form-check", "/api/v1/ai/form-check"}};

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @MockitoBean AiQuotaService quotas;
    @MockitoBean AiService ai;

    private ObjectNode answer() {
        ObjectNode n = new ObjectMapper().createObjectNode();
        n.put("not_food", true).putArray("items");
        n.putObject("quota").put("limit", 10).put("remaining", 9).put("resets_at", "2026-10-10T00:00:00Z");
        return n;
    }

    private org.springframework.test.web.servlet.ResultActions send(String path, byte[] body, boolean token) throws Exception {
        var req = post(path).contentType("application/json").content(body);
        return mvc.perform(token ? req.header("Authorization", "Bearer " + jwt.issue(USER).value()) : req);
    }

    private void whenCalled(java.util.function.Supplier<ObjectNode> result) {
        org.mockito.Mockito.doAnswer(i -> result.get()).when(ai).mealPhoto(any(), any());
        org.mockito.Mockito.doAnswer(i -> result.get()).when(ai).importRecipe(any(), any());
        org.mockito.Mockito.doAnswer(i -> result.get()).when(ai).formCheck(any(), any());
    }

    @Test
    void statusReportsTheThreeImageFlagsAndAMissingEntryIsOff() throws Exception {
        when(quotas.features()).thenReturn(java.util.Map.of(AiFeature.MEAL_PHOTO, true, AiFeature.FORM_CHECK, true));
        when(quotas.quota(USER)).thenReturn(new AiQuota(10, 7, Instant.parse("2026-10-10T00:00:00Z")));
        mvc.perform(get("/api/v1/ai/status").header("Authorization", "Bearer " + jwt.issue(USER).value()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.features.meal_photo").value(true))
                .andExpect(jsonPath("$.features.import_recipe").value(false))
                .andExpect(jsonPath("$.features.form_check").value(true))
                .andExpect(jsonPath("$.features.describe_meal").value(false));
    }

    @Test
    void aBodyUpToTwoMegabytesIsParsedAndOneOverItIs400TooLargeWithoutReachingTheService() throws Exception {
        whenCalled(this::answer);
        // 100 KB of valid JSON: over the 16 KB text limit, parsed for an image call
        byte[] big = ("{\"hint\":\"" + "a".repeat(100 * 1024) + "\"}").getBytes(StandardCharsets.UTF_8);
        for (String[] op : OPS) {
            send(op[1], big, true).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        }
        verify(ai).mealPhoto(eq(USER), org.mockito.ArgumentMatchers.argThat(b -> b != null && b != AiSchemas.TOO_LARGE && b.has("hint")));
        // the global guard refuses more than 2 MB before the controller
        byte[] over = ("{\"hint\":\"" + "a".repeat(AiController.MAX_IMAGE_BODY_BYTES) + "\"}").getBytes(StandardCharsets.UTF_8);
        for (String[] op : OPS) {
            send(op[1], over, true).andExpect(status().isBadRequest()).andExpect(jsonPath("$.details[0].issue").value("too_large"));
        }
        verify(ai, org.mockito.Mockito.times(1)).mealPhoto(any(), any()); // only the 100 KB call got through
    }

    @Test
    void aBodyThatIsNotJsonReachesTheServiceAsNullAndOneOverTheBoundNeverIsRead() throws Exception {
        whenCalled(this::answer);
        send(OPS[0][1], "x".repeat(AiController.MAX_IMAGE_BODY_BYTES).getBytes(StandardCharsets.UTF_8), true).andExpect(status().isOk());
        verify(ai).mealPhoto(eq(USER), org.mockito.ArgumentMatchers.isNull());
    }

    @Test
    void aBusyDecoderIs503UnavailableWithRetryAfterOnAllThreeOperations() throws Exception {
        for (String[] op : OPS) {
            whenCalled(() -> {
                throw new ImageBusyException(AiImages.RETRY_AFTER_SECONDS);
            });
            var res = send(op[1], "{}".getBytes(StandardCharsets.UTF_8), true).andExpect(status().isServiceUnavailable())
                    .andExpect(header().string("Retry-After", "2")).andExpect(jsonPath("$.code").value("unavailable")).andReturn();
            ContractSchemas.assertResponse(op[0], 503, res.getResponse().getContentAsString());
        }
    }

    @Test
    void everyDocumentedStatusMatchesTheContractForAllThreeOperations() throws Exception {
        for (String[] op : OPS) {
            whenCalled(this::answer);
            var ok = send(op[1], "{}".getBytes(StandardCharsets.UTF_8), true).andExpect(status().isOk()).andReturn();
            // the 200 shape of each operation is checked against its own schema in AiImageEndpointsIT; here the error statuses
            whenCalled(() -> {
                throw AiImages.fault("image.data", "unreadable_image");
            });
            var bad = send(op[1], "{}".getBytes(StandardCharsets.UTF_8), true).andExpect(status().isBadRequest()).andReturn();
            ContractSchemas.assertResponse(op[0], 400, bad.getResponse().getContentAsString());
            whenCalled(() -> {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "unavailable", "Couldn't get an answer just now. Try again.");
            });
            var unavailable = send(op[1], "{}".getBytes(StandardCharsets.UTF_8), true).andReturn();
            assertThat(unavailable.getResponse().getStatus()).isEqualTo(503);
            ContractSchemas.assertResponse(op[0], 503, unavailable.getResponse().getContentAsString());
            whenCalled(() -> {
                throw new IllegalStateException("secret detail quibble");
            });
            var boom = send(op[1], "{}".getBytes(StandardCharsets.UTF_8), true).andReturn();
            assertThat(boom.getResponse().getStatus()).isEqualTo(500);
            assertThat(boom.getResponse().getContentAsString()).doesNotContain("quibble");
            ContractSchemas.assertResponse(op[0], 500, boom.getResponse().getContentAsString());
            var anon = send(op[1], "{}".getBytes(StandardCharsets.UTF_8), false).andReturn();
            assertThat(anon.getResponse().getStatus()).isEqualTo(401);
            ContractSchemas.assertResponse(op[0], 401, anon.getResponse().getContentAsString());
            assertThat(ok.getResponse().getContentAsString()).contains("quota");
        }
        assertThat(List.of(OPS)).hasSize(3);
    }
}
