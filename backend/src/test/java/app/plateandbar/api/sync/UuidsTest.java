package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class UuidsTest {

    @Test
    void matchesRfc4122Version5Vector() {
        // uuid5(NAMESPACE_DNS, "www.example.com") from the reference implementation.
        UUID dns = UUID.fromString("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
        assertThat(Uuids.v5(dns, "www.example.com").toString()).isEqualTo("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    }

    @Test
    void isDeterministicPerNamespaceAndName() {
        UUID a = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID b = UUID.fromString("22222222-2222-2222-2222-222222222222");
        assertThat(Uuids.v5(a, "day_notes:2026-10-08")).isEqualTo(Uuids.v5(a, "day_notes:2026-10-08"));
        assertThat(Uuids.v5(a, "day_notes:2026-10-08")).isNotEqualTo(Uuids.v5(b, "day_notes:2026-10-08"));
        assertThat(Uuids.v5(a, "day_notes:2026-10-08")).isNotEqualTo(Uuids.v5(a, "day_notes:2026-10-09"));
        assertThat(Uuids.v5(a, "x").version()).isEqualTo(5);
    }

    @Test
    void canonicalFormOnly() {
        assertThat(Uuids.isCanonical("2ed6657d-e927-568b-95e1-2665a8aea6a2")).isTrue();
        assertThat(Uuids.isCanonical("2ED6657D-E927-568B-95E1-2665A8AEA6A2")).isTrue();
        assertThat(Uuids.isCanonical("1-1-1-1-1")).isFalse();
        assertThat(Uuids.isCanonical("2ed6657de927568b95e12665a8aea6a2")).isFalse();
        assertThat(Uuids.isCanonical(null)).isFalse();
    }
}
