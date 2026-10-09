package app.plateandbar.api.ai;

import app.plateandbar.api.common.ApiException;
import org.springframework.http.HttpStatus;

/** 429 {@code quota_exceeded}: carries the quota (remaining 0) and the seconds until it resets (Retry-After). */
public class QuotaExceededException extends ApiException {
    private final AiQuota quota;
    private final long retryAfterSeconds;

    public QuotaExceededException(AiQuota quota, long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, "quota_exceeded",
                "You've used today's AI requests. You can still add it yourself.");
        this.quota = quota;
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }

    public AiQuota quota() {
        return quota;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
