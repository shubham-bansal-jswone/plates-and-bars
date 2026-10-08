package app.plateandbar.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.support.MutableClock;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/** The real JWKS source (cache, rate limit, timeouts) against a local HTTP server standing in for Google. */
class GoogleJwksStubTest {

    static final String CLIENT = "test-client-id.apps.googleusercontent.com";
    final MutableClock clock = new MutableClock(Instant.now()); // Nimbus checks exp against the system clock
    HttpServer server;
    final AtomicInteger fetches = new AtomicInteger();
    RSAKey served;

    @BeforeEach
    void start() throws Exception {
        served = new RSAKeyGenerator(2048).keyID("served").generate();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/certs", ex -> {
            fetches.incrementAndGet();
            byte[] body = new JWKSet(served.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/certs";
    }

    private String token(RSAKey signingKey) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("https://accounts.google.com")
                .subject("sub-1")
                .audience(List.of(CLIENT))
                .issuedAt(clock.instant())
                .expiresAt(clock.instant().plus(Duration.ofHours(1)))
                .claim("email", "a@example.com")
                .claim("email_verified", true)
                .build();
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(signingKey)))
                .encode(JwtEncoderParameters.from(
                        JwsHeader.with(SignatureAlgorithm.RS256).keyId(signingKey.getKeyID()).build(), claims))
                .getTokenValue();
    }

    @Test
    void validTokenVerifiesAgainstTheServedKeySet() {
        var v = AuthConfig.create(url(), 30_000, List.of(CLIENT), clock);
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
    }

    @Test
    void unknownKeyIdTwiceWithinTheRateLimitWindowIs401Both() throws Exception {
        var v = AuthConfig.create(url(), 30_000, List.of(CLIENT), clock);
        RSAKey stranger = new RSAKeyGenerator(2048).keyID("unknown").generate();
        for (int i = 0; i < 2; i++) {
            assertThatThrownBy(() -> v.verify(token(stranger)))
                    .isInstanceOfSatisfying(ApiException.class, e -> {
                        assertThat(e.status().value()).isEqualTo(401);
                        assertThat(e.code()).isEqualTo("unauthorized");
                    });
        }
        // A good token still verifies afterwards.
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
    }

    @Test
    void googleUnreachableIsAServerFaultNot401() {
        String dead = url();
        server.stop(0);
        var v = AuthConfig.create(dead, 30_000, List.of(CLIENT), clock);
        assertThatThrownBy(() -> v.verify(token(served))).isInstanceOf(JwtException.class);
    }
}
