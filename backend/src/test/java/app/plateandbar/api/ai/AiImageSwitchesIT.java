package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.plateandbar.api.sync.ContractSchemas;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Each image call has its own kill switch, and the 5 a minute limit is shared with every other AI call. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.ai.meal-photo-enabled=true", "app.ai.describe-meal-enabled=true", "app.ai.monthly-budget-tokens=100000"})
@Import(AiITBase.Config.class)
class AiImageSwitchesIT extends AiITBase {

    @MockitoBean AiProvider provider;

    @Test
    void onlyTheFlaggedImageCallIsOnAndTheOthersAreFeatureDisabledBeforeAnyValidation() {
        when(provider.complete(any(), any(), any(), anyList()))
                .thenReturn(new AiProvider.Completion(AiImageEndpointsIT.MEAL_REPLY, 1, 1));
        String u = newUser();
        var status = get(u, "/api/v1/ai/status");
        ContractSchemas.assertResponse("GET /ai/status", 200, status.getBody());
        assertThat(status.getBody()).contains("\"meal_photo\":true", "\"import_recipe\":false", "\"form_check\":false");
        assertThat(post(u, AiImageEndpointsIT.PHOTO, AiImageEndpointsIT.MEAL_BODY).getStatusCode().value()).isEqualTo(200);
        for (String[] c : new String[][] {{"POST /ai/import-recipe", AiImageEndpointsIT.RECIPE}, {"POST /ai/form-check", AiImageEndpointsIT.FORM}}) {
            var res = post(u, c[1], "{}"); // the switch is checked before the body
            assertThat(res.getStatusCode().value()).as(c[0]).isEqualTo(503);
            ContractSchemas.assertResponse(c[0], 503, res.getBody());
            assertThat(res.getBody()).contains("feature_disabled");
        }
        assertThat(calls(u)).isEqualTo(1);
        verify(provider, never()).complete(org.mockito.ArgumentMatchers.eq(AiFeature.FORM_CHECK), any(), any(), anyList());
    }

    @Test
    void theSixthPostInAMinuteAcrossTextAndImageCallsIs429RateLimited() {
        when(provider.complete(any(), any(), any(), anyList()))
                .thenReturn(new AiProvider.Completion(AiImageEndpointsIT.MEAL_REPLY, 1, 1));
        when(provider.complete(any(), any(), any()))
                .thenReturn(new AiProvider.Completion(AiEndpointsIT.MEAL, 1, 1));
        String u = newUser();
        for (int i = 0; i < 3; i++) {
            assertThat(post(u, AiImageEndpointsIT.PHOTO, AiImageEndpointsIT.MEAL_BODY).getStatusCode().value()).isEqualTo(200);
        }
        assertThat(post(u, "/api/v1/ai/describe-meal", "{\"text\":\"rice\"}").getStatusCode().value()).isEqualTo(200);
        assertThat(post(u, AiImageEndpointsIT.RECIPE, "{}").getStatusCode().value()).isEqualTo(503); // off, still counted
        var sixth = post(u, AiImageEndpointsIT.PHOTO, AiImageEndpointsIT.MEAL_BODY);
        assertThat(sixth.getStatusCode().value()).isEqualTo(429);
        ContractSchemas.assertResponse("POST /ai/meal-photo", 429, sixth.getBody());
        assertThat(sixth.getBody()).contains("rate_limited");
        assertThat(calls(u)).isEqualTo(4);
        clock.advance(java.time.Duration.ofMinutes(1));
        assertThat(post(u, AiImageEndpointsIT.PHOTO, AiImageEndpointsIT.MEAL_BODY).getStatusCode().value()).isEqualTo(200);
    }
}
