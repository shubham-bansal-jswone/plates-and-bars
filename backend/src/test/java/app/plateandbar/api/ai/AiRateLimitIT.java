package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** The default 5 per minute per user across the three POSTs; status is outside it. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.ai.describe-meal-enabled=true", "app.ai.monthly-budget-tokens=100000"})
@Import(AiITBase.Config.class)
class AiRateLimitIT extends AiITBase {

    @MockitoBean AiProvider provider;

    @Test
    void sixthPostInAMinuteIsRateLimitedEvenWhenEarlierOnesWere400s() {
        String u = newUser();
        for (int i = 0; i < 5; i++) {
            assertThat(post(u, "/api/v1/ai/describe-meal", "{\"text\":\"  \"}").getStatusCode().value()).isEqualTo(400);
        }
        var sixth = post(u, "/api/v1/ai/ask-why", "{}");
        assertThat(sixth.getStatusCode().value()).isEqualTo(429);
        assertThat(sixth.getHeaders().getFirst("Retry-After")).isNotNull();
        assertThat(sixth.getBody()).contains("\"code\":\"rate_limited\"");
        for (int i = 0; i < 8; i++) {
            assertThat(get(u, "/api/v1/ai/status").getStatusCode().value()).isEqualTo(200);
        }
        assertThat(post(newUser(), "/api/v1/ai/describe-meal", "{\"text\":\" \"}").getStatusCode().value()).isEqualTo(400);
        assertThat(calls(u)).isZero();
        clock.advance(java.time.Duration.ofMinutes(1));
        assertThat(post(u, "/api/v1/ai/describe-meal", "{\"text\":\" \"}").getStatusCode().value()).isEqualTo(400);
    }
}
