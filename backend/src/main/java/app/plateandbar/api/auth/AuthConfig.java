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
        return create(GOOGLE_JWKS_URI, 30_000, props.googleClientIds(), clock);
    }

    /** Bounded timeouts, cached keys, a minimum gap between refetches, RS256 only. */
    static GoogleIdTokenVerifier create(
            String jwksUri, long refetchGapMillis, java.util.List<String> clientIds, java.time.Clock clock) {
        return create(jwksUri, refetchGapMillis, TimeUnit.HOURS.toMillis(1), clientIds, clock);
    }

    /** Cache TTL is a parameter so tests can expire the cache in real time; production uses one hour. */
    static GoogleIdTokenVerifier create(
            String jwksUri,
            long refetchGapMillis,
            long cacheTtlMillis,
            java.util.List<String> clientIds,
            java.time.Clock clock) {
        DefaultResourceRetriever http = new DefaultResourceRetriever(2000, 2000, 51_200);
        // Records whether the last fetch returned a parseable key set (see GoogleIdTokenVerifier).
        java.util.concurrent.atomic.AtomicBoolean loaded = new java.util.concurrent.atomic.AtomicBoolean(false);
        com.nimbusds.jose.util.ResourceRetriever retriever = url -> {
            try {
                com.nimbusds.jose.util.Resource r = http.retrieveResource(url);
                // Parsing here only decides the flag; Nimbus parses the returned content again for real.
                com.nimbusds.jose.jwk.JWKSet.parse(r.getContent());
                loaded.set(true);
                return r;
            } catch (java.io.IOException | java.text.ParseException e) {
                loaded.set(false);
                throw e instanceof java.text.ParseException
                        ? new java.io.IOException("JWK set is not parseable", e)
                        : (java.io.IOException) e;
            }
        };
        JWKSource<SecurityContext> source;
        try {
            JWKSourceBuilder<SecurityContext> builder = JWKSourceBuilder.create(new URL(jwksUri), retriever)
                    .cache(cacheTtlMillis, Math.min(TimeUnit.SECONDS.toMillis(15), cacheTtlMillis / 4));
            if (cacheTtlMillis < TimeUnit.HOURS.toMillis(1)) {
                // Test-only short TTLs cannot fit Nimbus's default 30 s refresh-ahead window.
                builder = builder.refreshAheadCache(false);
            }
            source = builder
                    .rateLimited(refetchGapMillis)
                    .retrying(true)
                    .build();
        } catch (MalformedURLException e) {
            throw new IllegalStateException(e);
        }
        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, source));
        return new GoogleIdTokenVerifier(new NimbusJwtDecoder(processor), clientIds, clock, loaded::get);
    }
}
