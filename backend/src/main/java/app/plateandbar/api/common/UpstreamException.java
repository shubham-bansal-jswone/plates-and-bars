package app.plateandbar.api.common;

import org.springframework.http.HttpStatus;

/**
 * 503 from a failing upstream: {@code upstream_unavailable} (Open Food Facts failed, or the feature is off) or
 * {@code upstream_busy} (the server's shared limit on calls to it is used up; {@code retryAfterSeconds} becomes the
 * Retry-After header, which the contract always sends for busy and may omit for unavailable).
 */
public class UpstreamException extends ApiException {
    private final Long retryAfterSeconds;

    private UpstreamException(String code, String message, Long retryAfterSeconds) {
        super(HttpStatus.SERVICE_UNAVAILABLE, code, message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public static UpstreamException unavailable() {
        return new UpstreamException(
                "upstream_unavailable", "Open Food Facts is not answering. Try again later or enter the food by hand.", null);
    }

    public static UpstreamException busy(long retryAfterSeconds) {
        return new UpstreamException("upstream_busy", "Open Food Facts is busy. Try again in a minute.", Math.max(1, retryAfterSeconds));
    }

    /** Null when the answer carries no Retry-After. */
    public Long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
