package app.plateandbar.api.ratelimit;

import app.plateandbar.api.common.ApiException;
import org.springframework.http.HttpStatus;

/** 429 {@code rate_limited}; {@code retryAfterSeconds} becomes the Retry-After header. */
public class RateLimitedException extends ApiException {
    public static final String MESSAGE = "Too many requests. Try again later.";

    private final String scope;
    private final long retryAfterSeconds;

    /** {@code scope} is the name of the limit that refused (a fixed label such as {@code ai-user}), used only for the security log. */
    public RateLimitedException(String scope, long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", MESSAGE);
        this.scope = scope;
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public String scope() {
        return scope;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
