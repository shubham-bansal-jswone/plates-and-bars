package app.plateandbar.api.ratelimit;

import app.plateandbar.api.ratelimit.RateLimitProperties.Limit;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.TimeMeter;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;

/**
 * In-memory Bucket4j token buckets keyed by (scope, key), held in a bounded Caffeine cache (Apache-2.0).
 * Keys (IPs, addresses, user ids) are stored only as SHA-256 digests and never logged. The cache holds at most
 * {@code maxKeys} buckets (least recently used go first) and drops a bucket once it has been idle for its longest
 * window, at which point it would be full again anyway. Memory is therefore bounded however many distinct keys an
 * attacker produces. Eviction under pressure can forgive an evicted key's recent requests; that is the accepted
 * price of the bound, and the guessing cap on email codes does not depend on it because it lives in MySQL.
 * State is per process and lost on restart.
 */
public class RateLimiter {

    private record Entry(Bucket bucket, long idleNanosBeforeFull) {}

    private final TimeMeter meter;
    private final Cache<String, Entry> buckets;

    public RateLimiter(Clock clock, long maxKeys) {
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
        this.buckets = Caffeine.newBuilder()
                .maximumSize(maxKeys)
                .ticker(() -> clock.millis() * 1_000_000L)
                // Run eviction on the calling thread so the bound holds immediately (and tests are deterministic).
                .executor(Runnable::run)
                .expireAfter(new Expiry<String, Entry>() {
                    @Override
                    public long expireAfterCreate(String k, Entry v, long now) {
                        return v.idleNanosBeforeFull();
                    }

                    @Override
                    public long expireAfterUpdate(String k, Entry v, long now, long cur) {
                        return cur;
                    }

                    @Override
                    public long expireAfterRead(String k, Entry v, long now, long cur) {
                        return v.idleNanosBeforeFull();
                    }
                })
                .build();
    }

    /** Takes one token from every limit or throws {@link RateLimitedException} with the longest wait. */
    public void consume(String scope, String key, Limit... limits) {
        String mapKey = scope + ":" + digest(key);
        Entry entry = buckets.get(mapKey, k -> newEntry(limits));
        ConsumptionProbe probe = entry.bucket().tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            long nanos = probe.getNanosToWaitForRefill();
            throw new RateLimitedException(Math.ceilDiv(nanos, 1_000_000_000L));
        }
    }

    public long trackedKeys() {
        buckets.cleanUp();
        return buckets.estimatedSize();
    }

    private Entry newEntry(Limit[] limits) {
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
        return new Entry(builder.build(), longest.toNanos());
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
