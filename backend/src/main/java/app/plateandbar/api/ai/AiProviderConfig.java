package app.plateandbar.api.ai;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

/**
 * An auto-configuration on purpose: it is processed after every application and test configuration, which is the only
 * way {@code @ConditionalOnMissingBean} reliably sees a provider declared elsewhere. The stub is the fallback: any other
 *  {@link AiProvider} bean replaces it and so lifts the "stub means off" rule.
 */
@AutoConfiguration
class AiProviderConfig {

    @Bean
    @ConditionalOnMissingBean(AiProvider.class)
    AiProvider stubAiProvider() {
        return new StubAiProvider();
    }
}
