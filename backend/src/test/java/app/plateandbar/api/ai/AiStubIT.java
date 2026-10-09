package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/** The real StubAiProvider is active and every flag and the budget are set: canned text still never reaches users. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.ai.describe-meal-enabled=true", "app.ai.ask-why-enabled=true",
            "app.ai.weekly-summary-enabled=true", "app.ai.monthly-budget-tokens=1000000",
            "app.rate-limit.ai-per-user.capacity=1000"})
@Import(AiITBase.Config.class)
class AiStubIT extends AiITBase {

    @Test
    void statusReportsEveryFeatureOffAndEveryEndpointIsFeatureDisabled() {
        String u = newUser();
        assertThat(get(u, "/api/v1/ai/status").getBody())
                .contains("\"describe_meal\":false", "\"ask_why\":false", "\"weekly_summary\":false");
        var res = post(u, "/api/v1/ai/describe-meal", "{\"text\":\"rice\"}");
        assertThat(res.getStatusCode().value()).isEqualTo(503);
        assertThat(res.getBody()).contains("feature_disabled").doesNotContain("Roti");
        assertThat(post(u, "/api/v1/ai/ask-why", "{\"card_id\":\"protein\",\"question\":\"why\"}").getBody())
                .contains("feature_disabled");
        assertThat(calls(u)).isZero();
    }
}
