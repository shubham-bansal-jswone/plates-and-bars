package app.plateandbar.api.ai;

import app.plateandbar.api.common.ApiException;
import org.springframework.http.HttpStatus;

/**
 * 503 {@code unavailable} because every image decode permit stayed taken for the whole wait (#990). It costs nothing: it
 * is thrown before the quota unit is reserved. {@code retryAfterSeconds} becomes the Retry-After header.
 */
public class ImageBusyException extends ApiException {
    private final long retryAfterSeconds;

    ImageBusyException(long retryAfterSeconds) {
        super(HttpStatus.SERVICE_UNAVAILABLE, "unavailable", "Couldn't get an answer just now. Try again.");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
