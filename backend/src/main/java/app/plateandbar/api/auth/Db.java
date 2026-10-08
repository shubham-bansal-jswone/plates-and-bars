package app.plateandbar.api.auth;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/** DATETIME(3) columns hold UTC; LocalDateTime avoids any driver or session time-zone conversion. */
final class Db {
    private Db() {}

    static LocalDateTime utc(Instant t) {
        return LocalDateTime.ofInstant(t, ZoneOffset.UTC);
    }

    static Instant instant(LocalDateTime t) {
        return t == null ? null : t.toInstant(ZoneOffset.UTC);
    }
}
