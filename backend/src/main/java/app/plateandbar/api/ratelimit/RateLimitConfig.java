package app.plateandbar.api.ratelimit;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(RateLimitProperties.class)
public class RateLimitConfig {

    @Bean
    RateLimiter rateLimiter(Clock clock) {
        return new RateLimiter(clock);
    }

    @Bean
    ClientIpResolver clientIpResolver(RateLimitProperties props) {
        return new ClientIpResolver(props.getTrustedProxies());
    }
}
