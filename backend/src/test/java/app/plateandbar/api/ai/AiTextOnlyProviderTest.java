package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.plateandbar.api.common.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** A provider with no image support (only the three-argument call) refuses an image call: 503 unavailable, unit given back. */
class AiTextOnlyProviderTest {

    final ObjectMapper json = new ObjectMapper();

    @Test
    void aTextOnlyProviderRefusesAnImageCallWith503AndReleasesTheUnitAndNeverSendsTextOnly() {
        List<String> textCalls = new ArrayList<>();
        AiProvider textOnly = (feature, instructions, input) -> {
            textCalls.add(input);
            return new AiProvider.Completion("{}", 1, 1);
        };
        AiQuotaService quotas = mock(AiQuotaService.class);
        AiQuotaService.Reservation held = new AiQuotaService.Reservation("u", java.time.LocalDate.of(2026, 10, 8),
                AiFeature.MEAL_PHOTO, new AiQuota(10, 9, Instant.parse("2026-10-09T00:00:00Z")));
        when(quotas.reserve(any(), any())).thenReturn(held);
        AiSchemas schemas = mock(AiSchemas.class);
        AiService service = new AiService(quotas, textOnly, schemas, mock(AiContent.class), mock(AiReplies.class), json);

        JsonNode vector = AiImagesTest.VECTORS.path("cases").get(0);
        var body = json.createObjectNode();
        body.putObject("image").put("media_type", vector.path("media_type").asString()).put("data", AiImagesTest.dataOf(vector));

        assertThatThrownBy(() -> service.mealPhoto("u", body)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status().value()).isEqualTo(503);
            assertThat(e.code()).isEqualTo("unavailable");
        });
        verify(quotas).release(held);
        verify(quotas, never()).recordTokens(any(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());
        assertThat(textCalls).isEmpty();
    }
}
