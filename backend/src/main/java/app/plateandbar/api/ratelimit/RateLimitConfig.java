package app.plateandbar.api.ratelimit;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

@Configuration
@EnableConfigurationProperties(RateLimitProperties.class)
public class RateLimitConfig {

    /** IP-keyed and user-keyed buckets (filter). */
    @Bean
    @Primary
    RateLimiter rateLimiter(Clock clock, RateLimitProperties props) {
        return new RateLimiter(clock, props.getMaxTrackedKeys());
    }

    /** Address-keyed buckets (code issuance), in their own cache so IP floods cannot evict them. */
    @Bean
    RateLimiter addressRateLimiter(Clock clock, RateLimitProperties props) {
        return new RateLimiter(clock, props.getAddressMaxTrackedKeys());
    }

    @Bean
    ClientIpResolver clientIpResolver(RateLimitProperties props) {
        return new ClientIpResolver(props.getTrustedProxies());
    }
}
