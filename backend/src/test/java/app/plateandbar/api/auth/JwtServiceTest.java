package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.MutableClock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    static final String KEY = "unit-test-signing-key-0123456789-abcdefghij";
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-08T06:30:00Z"));
    final JwtService jwt = new JwtService(new AuthProperties(KEY, List.of()), clock);

    @Test
    void tokenIsValidFor15MinutesThenExpires() {
        JwtService.AccessToken t = jwt.issue("user-1");
        assertThat(t.expiresAt()).isEqualTo(Instant.parse("2026-10-08T06:45:00Z"));

        clock.advance(Duration.ofMinutes(14).plusSeconds(59));
        assertThat(jwt.verify(t.value())).isEqualTo("user-1");

        clock.advance(Duration.ofSeconds(1));
        assertThatThrownBy(() -> jwt.verify(t.value()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("token_expired"));
    }

    @Test
    void accessTokenExpiryIsWholeSecondsAndEqualsJwtExp() {
        MutableClock c = new MutableClock(Instant.parse("2026-10-08T06:30:00.789Z"));
        JwtService svc = new JwtService(new AuthProperties(KEY, List.of()), c);
        JwtService.AccessToken t = svc.issue("user-1");
        assertThat(t.expiresAt()).isEqualTo(Instant.parse("2026-10-08T06:45:00Z"));
        String payload = new String(java.util.Base64.getUrlDecoder().decode(t.value().split("\\.")[1]));
        assertThat(payload).contains("\"exp\":" + t.expiresAt().getEpochSecond());
    }

    @Test
    void tokenSignedWithAnotherKeyIsUnauthorized() {
        JwtService other = new JwtService(new AuthProperties("another-signing-key-0123456789-abcdefghijk", List.of()), clock);
        String forged = other.issue("user-1").value();
        assertThatThrownBy(() -> jwt.verify(forged))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("unauthorized"));
    }

    @Test
    void garbageAndUnsignedTokensAreUnauthorized() {
        // Built at runtime so no JWT-shaped literal sits in the source.
        java.util.Base64.Encoder b64 = java.util.Base64.getUrlEncoder().withoutPadding();
        String unsigned = b64.encodeToString("{\"alg\":\"none\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8))
                + "." + b64.encodeToString(
                        "{\"sub\":\"user-1\",\"iss\":\"plate-and-bar\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8))
                + ".";
        for (String bad : List.of("", "abc", "a.b.c", unsigned)) {
            assertThatThrownBy(() -> jwt.verify(bad))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("unauthorized"));
        }
    }

    @Test
    void missingOrShortKeyRefusesToStart() {
        assertThatThrownBy(() -> new JwtService(new AuthProperties("", List.of()), clock))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new JwtService(new AuthProperties("short", List.of()), clock))
                .isInstanceOf(IllegalStateException.class);
    }

    private String signed(com.nimbusds.jose.JWSAlgorithm alg, com.nimbusds.jose.JWSSigner signer, String issuer)
            throws Exception {
        var claims = new com.nimbusds.jwt.JWTClaimsSet.Builder()
                .subject("user-1")
                .issuer(issuer)
                .expirationTime(java.util.Date.from(clock.instant().plus(Duration.ofMinutes(5))))
                .build();
        var jwt = new com.nimbusds.jwt.SignedJWT(new com.nimbusds.jose.JWSHeader(alg), claims);
        jwt.sign(signer);
        return jwt.serialize();
    }

    private void assertUnauthorized(String token) {
        assertThatThrownBy(() -> jwt.verify(token))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("unauthorized"));
    }

    @Test
    void wrongIssuerIsUnauthorized() throws Exception {
        byte[] key = KEY.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        assertUnauthorized(signed(
                com.nimbusds.jose.JWSAlgorithm.HS256, new com.nimbusds.jose.crypto.MACSigner(key), "someone-else"));
    }

    @Test
    void hs512WithTheSameKeyIsUnauthorized() throws Exception {
        var b64 = java.util.Base64.getUrlEncoder().withoutPadding();
        var utf8 = java.nio.charset.StandardCharsets.UTF_8;
        String exp = String.valueOf(clock.instant().plus(Duration.ofMinutes(5)).getEpochSecond());
        String input = b64.encodeToString("{\"alg\":\"HS512\"}".getBytes(utf8)) + "."
                + b64.encodeToString(
                        ("{\"sub\":\"user-1\",\"iss\":\"plate-and-bar\",\"exp\":" + exp + "}").getBytes(utf8));
        var mac = javax.crypto.Mac.getInstance("HmacSHA512");
        mac.init(new javax.crypto.spec.SecretKeySpec(KEY.getBytes(utf8), "HmacSHA512"));
        assertUnauthorized(input + "." + b64.encodeToString(mac.doFinal(input.getBytes(utf8))));
    }

    @Test
    void rs256TokenIsUnauthorized() throws Exception {
        var rsa = new com.nimbusds.jose.jwk.gen.RSAKeyGenerator(2048).generate();
        assertUnauthorized(signed(
                com.nimbusds.jose.JWSAlgorithm.RS256, new com.nimbusds.jose.crypto.RSASSASigner(rsa), "plate-and-bar"));
    }
}
