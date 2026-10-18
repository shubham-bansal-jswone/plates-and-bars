package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.support.MutableClock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/** V10__barcode_cache.sql on a real MySQL, and the repository's time to live against a fake clock. */
class BarcodeCacheIT extends BarcodeITBase {

    private static final Instant T0 = Instant.parse("2026-10-18T12:00:00Z");

    private BarcodeCache cacheAt(MutableClock c) {
        return new BarcodeCache(jdbc, c, new OffProperties(null, null, null, null, null, null, null, null, null, null));
    }

    @Test
    void migrationCreatedTheTableWithNoUserColumnsAndItIsApplied() {
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'barcode_cache'"
                        + " ORDER BY ordinal_position", String.class);
        assertThat(columns).containsExactly("code", "found", "payload", "fetched_at", "expires_at");
        assertThat(jdbc.queryForObject(
                "SELECT success FROM flyway_schema_history WHERE description = 'barcode cache'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForList(
                "SELECT column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE()"
                        + " AND table_name = 'barcode_cache' AND constraint_name = 'PRIMARY'", String.class)).containsExactly("code");
    }

    @Test
    void thePayloadMustBeJsonAndTheCodeIsUnique() {
        String sql = "INSERT INTO barcode_cache (code, found, payload, fetched_at, expires_at) VALUES (?, 1, ?, NOW(3), NOW(3))";
        jdbc.update(sql, "96385074", "{\"a\":1}");
        assertThatThrownBy(() -> jdbc.update(sql, "96385074", "{}")).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(sql, "036000291452", "not json")).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void aHitLivesThirtyDaysAndAMissTwentyFourHours() {
        MutableClock c = new MutableClock(T0);
        BarcodeCache cache = cacheAt(c);
        cache.put("96385074", "{\"code\":\"96385074\"}");
        cache.put("036000291452", null);

        assertThat(cache.find("96385074")).hasValueSatisfying(e -> {
            assertThat(e.found()).isTrue();
            assertThat(e.payload()).contains("96385074");
        });
        assertThat(cache.find("036000291452")).hasValueSatisfying(e -> {
            assertThat(e.found()).isFalse();
            assertThat(e.payload()).isNull();
        });
        assertThat(cache.find("4006381333931")).isEmpty();

        c.advance(Duration.ofHours(24).minusMillis(1));
        assertThat(cache.find("036000291452")).isPresent();
        c.advance(Duration.ofMillis(1));
        assertThat(cache.find("036000291452")).as("a miss ends at exactly 24 hours").isEmpty();
        assertThat(cache.find("96385074")).isPresent();

        c.advance(Duration.ofDays(30).minus(Duration.ofHours(24)).minusMillis(1));
        assertThat(cache.find("96385074")).isPresent();
        c.advance(Duration.ofMillis(1));
        assertThat(cache.find("96385074")).as("a hit ends at exactly 30 days").isEmpty();
    }

    @Test
    void writingAgainReplacesTheRowAndRestartsTheClock() {
        MutableClock c = new MutableClock(T0);
        BarcodeCache cache = cacheAt(c);
        cache.put("96385074", null);
        c.advance(Duration.ofHours(20));
        cache.put("96385074", "{\"code\":\"96385074\"}");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM barcode_cache WHERE code = '96385074'", Integer.class)).isEqualTo(1);
        c.advance(Duration.ofDays(29));
        assertThat(cache.find("96385074")).hasValueSatisfying(e -> assertThat(e.found()).isTrue());
    }

    @Test
    void writingDeletesExpiredRowsOfAnyCode() {
        MutableClock c = new MutableClock(T0);
        BarcodeCache cache = cacheAt(c);
        cache.put("96385074", null);
        c.advance(Duration.ofHours(25));
        cache.put("036000291452", null);
        assertThat(jdbc.queryForList("SELECT code FROM barcode_cache", String.class)).containsExactly("036000291452");
    }
}
