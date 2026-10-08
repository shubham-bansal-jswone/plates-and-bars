package app.plateandbar.api.ratelimit;

import app.plateandbar.api.ratelimit.RateLimitProperties.Limit;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.TimeMeter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * In-memory Bucket4j token buckets keyed by (scope, key). Keys (IPs, addresses, user ids) are stored only
 * as SHA-256 digests and never logged. A bucket idle for longer than its longest window is full again, so
 * it is dropped by a periodic sweep without changing any outcome. State is per process and lost on restart,
 * which is acceptable for abuse throttling (the failed-code cap is persisted instead, see EmailVerifyFailures).
 */
public class RateLimiter {

    private static final long SWEEP_EVERY_MILLIS = 60_000;

    private static final class Entry {
        final Bucket bucket;
        final long idleMillisBeforeFull;
        volatile long lastUsedMillis;

        Entry(Bucket bucket, long idleMillisBeforeFull, long now) {
            this.bucket = bucket;
            this.idleMillisBeforeFull = idleMillisBeforeFull;
            this.lastUsedMillis = now;
        }
    }

    private final Clock clock;
    private final TimeMeter meter;
    private final Map<String, Entry> buckets = new ConcurrentHashMap<>();
    private final AtomicLong lastSweepMillis;

    public RateLimiter(Clock clock) {
        this.clock = clock;
        this.meter = new TimeMeter() {
            @Override
            public long currentTimeNanos() {
                return clock.millis() * 1_000_000L;
            }

            @Override
            public boolean isWallClockBased() {
                return true;
            }
        };
        this.lastSweepMillis = new AtomicLong(clock.millis());
    }

    /** Takes one token from every limit or throws {@link RateLimitedException} with the longest wait. */
    public void consume(String scope, String key, Limit... limits) {
        long now = clock.millis();
        sweep(now);
        String mapKey = scope + ":" + digest(key);
        Entry entry = buckets.computeIfAbsent(mapKey, k -> newEntry(limits, now));
        entry.lastUsedMillis = now;
        ConsumptionProbe probe = entry.bucket.tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            long nanos = probe.getNanosToWaitForRefill();
            throw new RateLimitedException(Math.ceilDiv(nanos, 1_000_000_000L));
        }
    }

    public int trackedKeys() {
        return buckets.size();
    }

    private Entry newEntry(Limit[] limits, long now) {
        var builder = Bucket.builder().withCustomTimePrecision(meter);
        Duration longest = Duration.ZERO;
        for (Limit l : limits) {
            builder.addLimit(Bandwidth.builder()
                    .capacity(l.getCapacity())
                    .refillGreedy(l.getCapacity(), l.getWindow())
                    .build());
            if (l.getWindow().compareTo(longest) > 0) {
                longest = l.getWindow();
            }
        }
        return new Entry(builder.build(), longest.toMillis(), now);
    }

    private void sweep(long now) {
        long last = lastSweepMillis.get();
        if (now - last >= SWEEP_EVERY_MILLIS && lastSweepMillis.compareAndSet(last, now)) {
            buckets.entrySet().removeIf(e -> now - e.getValue().lastUsedMillis > e.getValue().idleMillisBeforeFull);
        }
    }

    private static String digest(String key) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
