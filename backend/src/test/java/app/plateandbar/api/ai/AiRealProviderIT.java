package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

/** A second, non-stub AiProvider bean: the context starts, the stub is not registered and the fake serves requests. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.ai.describe-meal-enabled=true", "app.ai.monthly-budget-tokens=1000000",
            "app.rate-limit.ai-per-user.capacity=1000"})
@Import({AiITBase.Config.class, AiRealProviderIT.FakeConfig.class})
class AiRealProviderIT extends AiITBase {

    static final AtomicInteger CALLS = new AtomicInteger();

    @TestConfiguration
    static class FakeConfig {
        @Bean
        AiProvider fakeProvider() {
            return (feature, instructions, input) -> {
                CALLS.incrementAndGet();
                return new AiProvider.Completion("{\"items\":[{\"name\":\"FakeDal\",\"qty\":\"1 bowl\",\"kcal\":150,"
                        + "\"protein_g\":9,\"carbs_g\":20,\"fat_g\":3}]}", 10, 10);
            };
        }
    }

    @Autowired ApplicationContext ctx;

    @Test
    void theFakeReplacesTheStubAndFeaturesFollowTheirFlags() {
        assertThat(ctx.getBeansOfType(AiProvider.class)).hasSize(1).containsOnlyKeys("fakeProvider");
        assertThat(ctx.getBeansOfType(StubAiProvider.class)).isEmpty();
        String u = newUser();
        assertThat(get(u, "/api/v1/ai/status").getBody()).contains("\"describe_meal\":true", "\"ask_why\":false");
        var res = post(u, "/api/v1/ai/describe-meal", "{\"text\":\"dal\"}");
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("FakeDal");
        assertThat(CALLS.get()).isEqualTo(1);
        assertThat(post(u, "/api/v1/ai/ask-why", "{\"card_id\":\"protein\",\"question\":\"why\"}").getBody())
                .contains("feature_disabled");
    }
}
