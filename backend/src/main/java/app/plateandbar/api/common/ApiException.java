package app.plateandbar.api.common;

import org.springframework.http.HttpStatus;

/** A failure with a fixed contract status, Error code and user-safe message. */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Sign in to continue.");
    }

    public static ApiException sessionEnded() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Your session has ended. Sign in again.");
    }

    public static ApiException tokenExpired() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "token_expired", "Access token expired. Refresh and retry.");
    }

    public static ApiException invalidCode() {
        return new ApiException(
                HttpStatus.UNAUTHORIZED, "invalid_code", "That code is wrong or has expired. Request a new one.");
    }
}
