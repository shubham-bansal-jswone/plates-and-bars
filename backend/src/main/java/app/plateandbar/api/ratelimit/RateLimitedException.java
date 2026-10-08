package app.plateandbar.api.ratelimit;

import app.plateandbar.api.common.ApiException;
import org.springframework.http.HttpStatus;

/** 429 {@code rate_limited}; {@code retryAfterSeconds} becomes the Retry-After header. */
public class RateLimitedException extends ApiException {
    public static final String MESSAGE = "Too many requests. Try again later.";

    private final long retryAfterSeconds;

    public RateLimitedException(long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", MESSAGE);
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
