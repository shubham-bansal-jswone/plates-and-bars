package app.plateandbar.api.auth;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class AuthConfig {

    static final String GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

    /** Fetches and caches Google's signing keys; nothing is requested until the first token is checked. */
    @Bean
    GoogleIdTokenVerifier googleIdTokenVerifier(AuthProperties props, java.time.Clock clock) {
        NimbusJwtDecoder decoder =
                NimbusJwtDecoder.withJwkSetUri(GOOGLE_JWKS_URI).build();
        return new GoogleIdTokenVerifier(decoder, props.googleClientIds(), clock);
    }
}
