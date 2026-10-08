package app.plateandbar.api.auth;

import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.concurrent.TimeUnit;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
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
        if (props.googleClientIds().isEmpty()) {
            org.slf4j.LoggerFactory.getLogger(AuthConfig.class)
                    .warn("GOOGLE_CLIENT_IDS is empty: every Google sign-in will be refused");
        }
        // Bounded timeouts, cached keys, a minimum gap between refetches, RS256 only.
        DefaultResourceRetriever retriever = new DefaultResourceRetriever(2000, 2000, 51_200);
        JWKSource<SecurityContext> source;
        try {
            source = JWKSourceBuilder.create(new URL(GOOGLE_JWKS_URI), retriever)
                    .cache(TimeUnit.HOURS.toMillis(1), TimeUnit.SECONDS.toMillis(15))
                    .rateLimited(TimeUnit.SECONDS.toMillis(30))
                    .retrying(true)
                    .build();
        } catch (MalformedURLException e) {
            throw new IllegalStateException(e);
        }
        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, source));
        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
        return new GoogleIdTokenVerifier(decoder, props.googleClientIds(), clock);
    }
}
