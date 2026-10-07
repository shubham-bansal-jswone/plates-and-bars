package app.plateandbar.api.common;

/** Thrown when the API is up but cannot serve (for example the database is unreachable). Maps to 503. */
public class ServiceUnavailableException extends RuntimeException {
    public ServiceUnavailableException(Throwable cause) {
        super("unavailable", cause);
    }
}
