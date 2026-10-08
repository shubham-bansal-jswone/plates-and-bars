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
    void tokenSignedWithAnotherKeyIsUnauthorized() {
        JwtService other = new JwtService(new AuthProperties("another-signing-key-0123456789-abcdefghijk", List.of()), clock);
        String forged = other.issue("user-1").value();
        assertThatThrownBy(() -> jwt.verify(forged))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("unauthorized"));
    }

    @Test
    void garbageAndUnsignedTokensAreUnauthorized() {
        String unsigned = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTEiLCJpc3MiOiJwbGF0ZS1hbmQtYmFyIn0.";
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
}
