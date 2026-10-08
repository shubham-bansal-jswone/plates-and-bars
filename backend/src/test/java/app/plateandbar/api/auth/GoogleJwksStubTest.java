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
    void unknownKeyIdIs401WithoutRefetchingInsideTheWindow() throws Exception {
        var v = AuthConfig.create(url(), 30_000, List.of(CLIENT), clock);
        RSAKey stranger = new RSAKeyGenerator(2048).keyID("unknown").generate();
        // First call loads the key set (1 fetch), the unknown kid then triggers a refetch (2 fetches).
        assertUnauthorized(v, token(stranger));
        assertThat(fetches.get()).isEqualTo(2);
        assertUnauthorized(v, token(stranger));
        assertThat(fetches.get()).isEqualTo(2);
        assertUnauthorized(v, token(stranger));
        assertThat(fetches.get()).isEqualTo(2);
        // A good token is served from cache: no new fetch.
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
        assertThat(fetches.get()).isEqualTo(2);
    }

    private void assertUnauthorized(GoogleIdTokenVerifier v, String token) {
        assertThatThrownBy(() -> v.verify(token)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status().value()).isEqualTo(401);
            assertThat(e.code()).isEqualTo("unauthorized");
        });
    }

    private void assertOutage(GoogleIdTokenVerifier v) {
        for (int i = 0; i < 4; i++) {
            // A JwtException (not ApiException) reaches ApiExceptionHandler, which answers 500 internal.
            assertThatThrownBy(() -> v.verify(token(served))).isInstanceOf(JwtException.class);
        }
    }

    @Test
    void connectionRefusedIsAlways500ThenRecovers() throws Exception {
        int port = server.getAddress().getPort();
        server.stop(0);
        var v = AuthConfig.create(url(), 30_000, List.of(CLIENT), clock);
        assertOutage(v);
        // Recovery: Google is back. The rate limit may delay the refetch, so use a short gap.
        var v2 = AuthConfig.create(url(), 100, List.of(CLIENT), clock);
        assertOutage(v2);
        restart(port, 200, null);
        Thread.sleep(150);
        assertThat(v2.verify(token(served)).subject()).isEqualTo("sub-1");
    }

    @Test
    void http503IsAlways500ThenRecovers() throws Exception {
        int port = server.getAddress().getPort();
        server.stop(0);
        restart(port, 503, "unavailable");
        var v = AuthConfig.create(url(), 100, List.of(CLIENT), clock);
        assertOutage(v);
        restart(port, 200, null);
        Thread.sleep(150);
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
    }

    @Test
    void nonJsonBodyIsAlways500ThenRecovers() throws Exception {
        int port = server.getAddress().getPort();
        server.stop(0);
        restart(port, 200, "<html>not json</html>");
        var v = AuthConfig.create(url(), 100, List.of(CLIENT), clock);
        assertOutage(v);
        restart(port, 200, null);
        Thread.sleep(150);
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
    }

    @Test
    void outageWithinTheRateLimitWindowStays500() throws Exception {
        int port = server.getAddress().getPort();
        server.stop(0);
        restart(port, 503, "unavailable");
        var v = AuthConfig.create(url(), 30_000, List.of(CLIENT), clock);
        assertOutage(v); // calls 3 and 4 hit the rate limit but must still be 500
    }

    /** Restarts the stub on the same port; a null body serves the real key set. */
    private void restart(int port, int status, String body) throws Exception {
        if (server != null) {
            server.stop(0);
        }
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/certs", ex -> {
            fetches.incrementAndGet();
            byte[] out = (body == null ? new JWKSet(served.toPublicJWK()).toString() : body)
                    .getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
    }

    @Test
    void keysLoadedThenGoogleGoesDownThenRecovers() throws Exception {
        int port = server.getAddress().getPort();
        var v = AuthConfig.create(url(), 2000, List.of(CLIENT), clock);
        RSAKey stranger = new RSAKeyGenerator(2048).keyID("unknown").generate();
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
        assertThat(fetches.get()).isEqualTo(1);
        Thread.sleep(2200);

        restart(port, 503, "unavailable");
        int before = fetches.get();
        // Unknown kid: failed refetch (500), never 401. The rate limiter lets two calls per window reach the
        // network, and each failed fetch is retried once, so a window costs at most four requests.
        assertThatThrownBy(() -> v.verify(token(stranger))).isInstanceOf(JwtException.class);
        // The source retries a failed fetch once, so a failed refetch costs up to two requests.
        int afterFailure = fetches.get();
        assertThat(afterFailure).isGreaterThan(before);
        for (int i = 0; i < 4; i++) {
            assertThatThrownBy(() -> v.verify(token(stranger))).isInstanceOf(JwtException.class);
        }
        assertThat(fetches.get()).isLessThanOrEqualTo(before + 4);
        afterFailure = fetches.get();
        // A known kid is still served from cache.
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
        assertThat(fetches.get()).isEqualTo(afterFailure);

        restart(port, 200, null);
        Thread.sleep(2200);
        int beforeRecovery = fetches.get();
        assertUnauthorized(v, token(stranger));
        int afterRecovery = fetches.get();
        assertThat(afterRecovery).isGreaterThan(beforeRecovery);
        // The limiter's second call in this window may refetch once more; after that it holds.
        assertUnauthorized(v, token(stranger));
        int settled = fetches.get();
        assertUnauthorized(v, token(stranger));
        assertThat(fetches.get()).isEqualTo(settled);
    }

    @Test
    void cacheExpiresWhileGoogleIsDownIs500Repeatedly() throws Exception {
        int port = server.getAddress().getPort();
        var v = AuthConfig.create(url(), 100, 500, List.of(CLIENT), clock);
        assertThat(v.verify(token(served)).subject()).isEqualTo("sub-1");
        restart(port, 503, "unavailable");
        Thread.sleep(700);
        assertOutage(v);
    }
}
