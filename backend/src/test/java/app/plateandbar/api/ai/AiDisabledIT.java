package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** The shipped defaults (no AI properties set): every endpoint is 503 feature_disabled and nothing is counted. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "app.rate-limit.ai-per-user.capacity=1000")
@Import(AiITBase.Config.class)
class AiDisabledIT extends AiITBase {

    @MockitoBean AiProvider provider;

    @Test
    void everyEndpointIsFeatureDisabledEvenForABadBodyAndStatusReportsOff() {
        String u = newUser();
        for (String path : new String[] {"describe-meal", "ask-why", "weekly-summary"}) {
            var res = post(u, "/api/v1/ai/" + path, "{}"); // switch is checked before validation
            assertThat(res.getStatusCode().value()).as(path).isEqualTo(503);
            assertThat(res.getBody()).contains("\"code\":\"feature_disabled\"");
        }
        var status = get(u, "/api/v1/ai/status");
        assertThat(status.getStatusCode().value()).isEqualTo(200);
        assertThat(status.getBody())
                .contains("\"describe_meal\":false", "\"ask_why\":false", "\"weekly_summary\":false")
                .contains("\"remaining\":10");
        assertThat(calls(u)).isZero();
        org.mockito.Mockito.verify(provider, org.mockito.Mockito.never()).complete(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void aFlagWithoutABudgetIsStillOff() {
        // The shipped budget is 0; AiQuotaIT covers flag plus budget turning a feature on.
        assertThat(get(newUser(), "/api/v1/ai/status").getBody()).doesNotContain(":true");
    }
}
