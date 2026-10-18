package app.plateandbar.api.foods;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * {@code barcode_cache} (V10): public product facts by barcode, no user data. Only a single-code lookup and a single-code
 * write exist, on purpose (ADR 009: no listing over the cache). A row is read only while {@code expires_at} is in the future,
 * and expired rows are deleted on write.
 */
@Repository
class BarcodeCache {

    /** What the cache holds for a code: a product (JSON text) or a recorded miss. */
    record Entry(boolean found, String payload) {}

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final OffProperties props;

    BarcodeCache(JdbcTemplate jdbc, Clock clock, OffProperties props) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.props = props;
    }

    Optional<Entry> find(String code) {
        List<Entry> rows = jdbc.query(
                "SELECT found, payload FROM barcode_cache WHERE code = ? AND expires_at > ?",
                (rs, i) -> new Entry(rs.getBoolean(1), rs.getString(2)),
                code, utc(clock.instant()));
        return rows.stream().findFirst();
    }

    /** {@code payload} null records a miss (kept for the miss time to live); otherwise a hit (the hit time to live). */
    void put(String code, String payload) {
        Instant now = clock.instant();
        Duration ttl = payload == null ? props.missTtl() : props.hitTtl();
        jdbc.update("DELETE FROM barcode_cache WHERE expires_at <= ? LIMIT 200", utc(now));
        jdbc.update(
                "INSERT INTO barcode_cache (code, found, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?) AS new"
                        + " ON DUPLICATE KEY UPDATE found = new.found, payload = new.payload,"
                        + " fetched_at = new.fetched_at, expires_at = new.expires_at",
                code, payload != null, payload, utc(now), utc(now.plus(ttl)));
    }

    /** DATETIME(3) columns hold UTC; LocalDateTime avoids any driver or session time-zone conversion. */
    private static LocalDateTime utc(Instant t) {
        return LocalDateTime.ofInstant(t, ZoneOffset.UTC);
    }
}
