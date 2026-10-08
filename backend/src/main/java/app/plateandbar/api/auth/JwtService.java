package app.plateandbar.api.auth;

import app.plateandbar.api.common.ApiException;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

/** Issues and verifies the 15-minute HS256 access JWT. The signing key comes from the environment only. */
@Component
public class JwtService {

    public static final Duration ACCESS_TTL = Duration.ofMinutes(15);
    private static final String ISSUER = "plate-and-bar";

    public record AccessToken(String value, Instant expiresAt) {}

    private final Clock clock;
    private final NimbusJwtEncoder encoder;
    private final NimbusJwtDecoder decoder;

    public JwtService(AuthProperties props, Clock clock) {
        String key = props.jwtSigningKey();
        if (key == null || key.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("JWT_SIGNING_KEY must be set to at least 32 bytes");
        }
        SecretKey secret = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        this.clock = clock;
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(secret));
        NimbusJwtDecoder d = NimbusJwtDecoder.withSecretKey(secret).macAlgorithm(MacAlgorithm.HS256).build();
        // Signature only here; expiry is checked below so it can be told apart from a bad token.
        d.setJwtValidator(jwt -> OAuth2TokenValidatorResult.success());
        this.decoder = d;
    }

    public AccessToken issue(String userId) {
        Instant now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        Instant exp = now.plus(ACCESS_TTL);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(userId)
                .issuedAt(now)
                .expiresAt(exp)
                .build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();
        return new AccessToken(token, exp);
    }

    /** Returns the user id, or throws 401 {@code token_expired} / {@code unauthorized}. */
    public String verify(String token) {
        Jwt jwt;
        try {
            jwt = decoder.decode(token);
        } catch (JwtException e) {
            throw ApiException.unauthorized();
        }
        if (!ISSUER.equals(jwt.getClaimAsString("iss"))
                || jwt.getSubject() == null
                || jwt.getExpiresAt() == null) {
            throw ApiException.unauthorized();
        }
        if (!clock.instant().isBefore(jwt.getExpiresAt())) {
            throw ApiException.tokenExpired();
        }
        return jwt.getSubject();
    }
}
