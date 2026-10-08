package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.MutableClock;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

class GoogleIdTokenVerifierTest {

    static final String CLIENT = "test-client-id.apps.googleusercontent.com";
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-08T06:30:00Z"));
    final RSAKey key = generate();
    final NimbusJwtEncoder signer = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
    final GoogleIdTokenVerifier verifier = new GoogleIdTokenVerifier(
            NimbusJwtDecoder.withPublicKey(publicKey()).build(), List.of(CLIENT), clock);

    private static RSAKey generate() {
        try {
            return new RSAKeyGenerator(2048).keyID("k1").generate();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private java.security.interfaces.RSAPublicKey publicKey() {
        try {
            return key.toRSAPublicKey();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String token(Map<String, Object> overrides) {
        JwtClaimsSet.Builder b = JwtClaimsSet.builder()
                .issuer("https://accounts.google.com")
                .subject("sub-123")
                .audience(List.of(CLIENT))
                .issuedAt(clock.instant())
                .expiresAt(clock.instant().plus(Duration.ofHours(1)))
                .claim("email", "  Asha@Example.com ")
                .claim("email_verified", true);
        b.claims(c -> c.putAll(overrides));
        return signer.encode(JwtEncoderParameters.from(
                        JwsHeader.with(SignatureAlgorithm.RS256).keyId("k1").build(), b.build()))
                .getTokenValue();
    }

    private void assertUnauthorized(String token) {
        assertThatThrownBy(() -> verifier.verify(token))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("unauthorized"));
    }

    @Test
    void validTokenYieldsSubAndNormalisedEmail() {
        var id = verifier.verify(token(Map.of()));
        assertThat(id.subject()).isEqualTo("sub-123");
        assertThat(id.email()).isEqualTo("asha@example.com");
    }

    @Test
    void emailVerifiedFalseOrMissingIsRefused() {
        assertUnauthorized(token(Map.of("email_verified", false)));
        assertUnauthorized(token(Map.of("email_verified", "false")));
        java.util.HashMap<String, Object> o = new java.util.HashMap<>();
        o.put("email_verified", null);
        assertUnauthorized(token(o));
    }

    @Test
    void emailVerifiedAsStringTrueIsAccepted() {
        assertThat(verifier.verify(token(Map.of("email_verified", "true"))).subject()).isEqualTo("sub-123");
    }

    @Test
    void wrongAudienceOrIssuerIsRefused() {
        assertUnauthorized(token(Map.of("aud", List.of("someone-else"))));
        assertUnauthorized(token(Map.of("iss", "https://evil.example")));
    }

    @Test
    void expiredTokenIsRefused() {
        assertUnauthorized(token(Map.of("iat", clock.instant().minus(Duration.ofHours(2)), "exp", clock.instant().minus(Duration.ofMinutes(5)))));
    }

    @Test
    void tokenSignedByAnotherKeyAndGarbageAreRefused() throws Exception {
        RSAKey other = new RSAKeyGenerator(2048).keyID("k1").generate();
        String forged = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(other)))
                .encode(JwtEncoderParameters.from(
                        JwsHeader.with(SignatureAlgorithm.RS256).keyId("k1").build(),
                        JwtClaimsSet.builder()
                                .issuer("https://accounts.google.com")
                                .subject("sub-123")
                                .audience(List.of(CLIENT))
                                .expiresAt(clock.instant().plusSeconds(600))
                                .claim("email", "a@b.com")
                                .claim("email_verified", true)
                                .build()))
                .getTokenValue();
        assertUnauthorized(forged);
        assertUnauthorized("not-a-jwt");
    }

    @Test
    void missingEmailIsRefused() {
        java.util.HashMap<String, Object> o = new java.util.HashMap<>();
        o.put("email", null);
        assertUnauthorized(token(o));
    }
}
