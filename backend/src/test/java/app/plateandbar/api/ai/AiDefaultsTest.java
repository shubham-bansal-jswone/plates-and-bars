package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.io.ClassPathResource;

/** The shipped application.yml, with no environment overrides: every flag off and the budget zero. */
class AiDefaultsTest {

    @Test
    void everyFlagIsOffByDefaultAndTheBudgetIsZero() throws Exception {
        MutablePropertySources sources = new MutablePropertySources();
        new YamlPropertySourceLoader().load("app", new ClassPathResource("application.yml")).forEach(sources::addLast);
        AiProperties props = new Binder(
                        ConfigurationPropertySources.from(sources),
                        new org.springframework.boot.context.properties.bind.PropertySourcesPlaceholdersResolver(sources))
                .bind("app.ai", AiProperties.class)
                .get();
        for (AiFeature f : AiFeature.values()) {
            assertThat(props.flag(f)).as(f.key()).isFalse();
        }
        assertThat(props.getMonthlyBudgetTokens()).isZero();
        assertThat(props.getDailyLimit()).isEqualTo(10);
        assertThat(List.of(AiFeature.values())).hasSize(3);
    }
}
