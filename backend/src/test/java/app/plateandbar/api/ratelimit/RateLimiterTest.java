package app.plateandbar.api.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.ratelimit.RateLimitProperties.Limit;
import app.plateandbar.api.support.MutableClock;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RateLimiterTest {

    MutableClock clock;
    RateLimiter limiter;

    @BeforeEach
    void setUp() {
        clock = new MutableClock(Instant.parse("2026-10-08T06:30:00Z"));
        limiter = new RateLimiter(clock, 1000);
    }

    @Test
    void tripsAtCapacityAndRecoversAsTheWindowRefills() {
        Limit l = new Limit(3, Duration.ofSeconds(30));
        for (int i = 0; i < 3; i++) {
            limiter.consume("s", "k", l);
        }
        assertThatThrownBy(() -> limiter.consume("s", "k", l))
                .isInstanceOfSatisfying(RateLimitedException.class, e -> {
                    assertThat(e.retryAfterSeconds()).isBetween(1L, 10L);
                    assertThat(e.status().value()).isEqualTo(429);
                    assertThat(e.code()).isEqualTo("rate_limited");
                });
        clock.advance(Duration.ofSeconds(10));
        assertThatCode(() -> limiter.consume("s", "k", l)).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.consume("s", "k", l)).isInstanceOf(RateLimitedException.class);
        clock.advance(Duration.ofSeconds(30));
        for (int i = 0; i < 3; i++) {
            limiter.consume("s", "k", l);
        }
    }

    @Test
    void keysAndScopesAreIndependent() {
        Limit l = new Limit(1, Duration.ofMinutes(1));
        limiter.consume("s", "a", l);
        limiter.consume("s", "b", l);
        limiter.consume("other", "a", l);
        assertThatThrownBy(() -> limiter.consume("s", "a", l)).isInstanceOf(RateLimitedException.class);
    }

    @Test
    void longestWaitOfSeveralLimitsIsReported() {
        Limit hour = new Limit(2, Duration.ofHours(1));
        Limit day = new Limit(3, Duration.ofDays(1));
        limiter.consume("s", "k", hour, day);
        limiter.consume("s", "k", hour, day);
        assertThatThrownBy(() -> limiter.consume("s", "k", hour, day))
                .isInstanceOfSatisfying(RateLimitedException.class, e -> assertThat(e.retryAfterSeconds())
                        .isBetween(1700L, 1800L));
        clock.advance(Duration.ofHours(1));
        limiter.consume("s", "k", hour, day);
        // The daily bucket is now spent even though the hourly one has refilled.
        clock.advance(Duration.ofHours(1));
        assertThatThrownBy(() -> limiter.consume("s", "k", hour, day))
                .isInstanceOfSatisfying(RateLimitedException.class, e -> assertThat(e.retryAfterSeconds())
                        .isGreaterThan(3600L));
    }

    @Test
    void idleBucketsAreSweptWithoutChangingOutcomes() {
        Limit l = new Limit(2, Duration.ofMinutes(1));
        for (int i = 0; i < 50; i++) {
            limiter.consume("s", "k" + i, l);
        }
        assertThat(limiter.trackedKeys()).isEqualTo(50);
        clock.advance(Duration.ofMinutes(5));
        limiter.consume("s", "fresh", l);
        assertThat(limiter.trackedKeys()).isEqualTo(1);
    }

    @Test
    void cacheNeverExceedsItsMaximumUnderManyDistinctKeys() {
        RateLimiter small = new RateLimiter(clock, 100);
        Limit l = new Limit(5, Duration.ofHours(1));
        for (int i = 0; i < 10_000; i++) {
            small.consume("ip", "2001:db8:" + i + "::/64", l);
            assertThat(small.trackedKeys()).isLessThanOrEqualTo(100);
        }
        assertThat(small.trackedKeys()).isPositive();
        // Limits still work for a key that is held.
        for (int i = 0; i < 5; i++) {
            small.consume("ip", "held", l);
        }
        assertThatThrownBy(() -> small.consume("ip", "held", l)).isInstanceOf(RateLimitedException.class);
    }
}
