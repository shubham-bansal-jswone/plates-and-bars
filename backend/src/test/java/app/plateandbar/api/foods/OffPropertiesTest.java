package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class OffPropertiesTest {

    private static OffProperties of(Boolean enabled, String baseUrl, String contact) {
        return new OffProperties(enabled, baseUrl, contact, null, null, null, null, null, null, null);
    }

    @Test
    void offByDefaultWithTheDocumentedDefaultsAndNoContactNeeded() {
        OffProperties p = of(null, null, null);
        assertThat(p.enabled()).isFalse();
        assertThat(p.baseUrl()).isEqualTo("https://world.openfoodfacts.org");
        assertThat(p.hitTtl()).isEqualTo(Duration.ofDays(30));
        assertThat(p.missTtl()).isEqualTo(Duration.ofHours(24));
        assertThat(p.upstreamPerMinute()).isEqualTo(12);
        assertThat(p.connectTimeout()).isEqualTo(Duration.ofSeconds(3));
        assertThat(p.readTimeout()).isEqualTo(Duration.ofSeconds(5));
        assertThat(p.maxBodyBytes()).isEqualTo(256 * 1024);
        assertThat(of(false, "", "").baseUrl()).isEqualTo("https://world.openfoodfacts.org");
    }

    @Test
    void enabledNeedsAContactAddress() {
        assertThatThrownBy(() -> of(true, null, null)).isInstanceOf(IllegalStateException.class).hasMessageContaining("OFF_CONTACT_EMAIL");
        assertThatThrownBy(() -> of(true, null, "   ")).isInstanceOf(IllegalStateException.class);
        assertThat(of(true, null, " me@example.org ").contact()).isEqualTo("me@example.org");
    }

    @Test
    void theContactCannotCarryAHeaderInjection() {
        assertThatThrownBy(() -> of(true, null, "a@b.c\r\nX-Evil: 1")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> of(true, null, "café@example.org")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> of(true, null, "a".repeat(101))).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void theBaseUrlMustBeHttpAndAnyTrailingSlashGoes() {
        assertThat(of(true, "http://localhost:8089/", "me@example.org").baseUrl()).isEqualTo("http://localhost:8089");
        assertThatThrownBy(() -> of(true, "ftp://example.org", "me@example.org")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> of(true, "not a url", "me@example.org")).isInstanceOf(RuntimeException.class);
    }
}
