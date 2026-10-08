package app.plateandbar.api.auth;

import app.plateandbar.api.common.ApiException;
import com.nimbusds.jose.jwk.source.JWKSetParseException;
import com.nimbusds.jose.jwk.source.JWKSetRetrievalException;
import com.nimbusds.jose.jwk.source.JWKSetUnavailableException;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Verifies a Google ID token (signature against Google's JWKS, issuer, audience, expiry) and applies
 * the ADR 004 rule that {@code email_verified} must be true. Identities are keyed by {@code sub}.
 */
public class GoogleIdTokenVerifier {

    public record GoogleIdentity(String subject, String email) {}

    private static final Logger log = LoggerFactory.getLogger(GoogleIdTokenVerifier.class);

    private final JwtDecoder decoder;

    private final java.util.function.BooleanSupplier keySetLoaded;

    public GoogleIdTokenVerifier(NimbusJwtDecoder decoder, List<String> clientIds, Clock clock) {
        this(decoder, clientIds, clock, () -> true);
    }

    /**
     * @param keySetLoaded true when the last JWKS fetch succeeded and parsed. Nimbus does not expose its
     *     cache, so {@link AuthConfig} tracks this by wrapping the retriever.
     */
    public GoogleIdTokenVerifier(
            NimbusJwtDecoder decoder, List<String> clientIds, Clock clock, java.util.function.BooleanSupplier keySetLoaded) {
        this.keySetLoaded = keySetLoaded;
        JwtTimestampValidator timestamps = new JwtTimestampValidator(Duration.ofSeconds(60));
        timestamps.setClock(clock);
        OAuth2TokenValidator<Jwt> issuer = jwt -> {
            String iss = jwt.getClaimAsString("iss");
            return "https://accounts.google.com".equals(iss) || "accounts.google.com".equals(iss)
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
        };
        OAuth2TokenValidator<Jwt> audience = jwt -> {
            List<String> aud = jwt.getAudience();
            return aud != null && aud.stream().anyMatch(clientIds::contains)
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(timestamps, issuer, audience));
        this.decoder = decoder;
    }

    private static boolean keySourceOutage(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof JWKSetRetrievalException
                    || t instanceof JWKSetUnavailableException
                    || t instanceof JWKSetParseException) {
                return true;
            }
            if (t.getCause() == t) {
                break;
            }
        }
        return false;
    }

    public GoogleIdentity verify(String idToken) {
        Jwt jwt;
        try {
            jwt = decoder.decode(idToken);
        } catch (BadJwtException e) {
            throw ApiException.unauthorized();
        } catch (JwtException e) {
            // Nimbus throws RateLimitReachedException both for an unknown key id inside the refetch window
            // and for any call after a failed fetch (outage). Only the first is the caller's fault: it is a
            // 401 when a key set is actually loaded. Otherwise Google's keys are unavailable, so rethrow
            // and let the handler answer 500 internal (logged at ERROR) so clients retry.
            if (!keySourceOutage(e) && keySetLoaded.getAsBoolean()) {
                // Anyone can trigger this without limit, so no WARN.
                log.debug("Google ID token refused: no matching key ({})", e.getClass().getSimpleName());
                throw ApiException.unauthorized();
            }
            throw e;
        }
        Object verified = jwt.getClaim("email_verified");
        boolean emailVerified = Boolean.TRUE.equals(verified) || "true".equals(verified);
        String email = jwt.getClaimAsString("email");
        String sub = jwt.getSubject();
        if (!emailVerified || email == null || email.isBlank() || sub == null || sub.isBlank()) {
            throw ApiException.unauthorized();
        }
        return new GoogleIdentity(sub, Emails.normalise(email));
    }
}
