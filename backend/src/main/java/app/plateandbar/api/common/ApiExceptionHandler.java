package app.plateandbar.api.common;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Maps every failure to the contract's {@code Error} schema. Messages are fixed text:
 * never echo request bodies or exception messages, which may carry food, weight or tokens.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ServiceUnavailableException.class)
    ResponseEntity<ErrorResponse> unavailable(ServiceUnavailableException e) {
        return respond(HttpStatus.SERVICE_UNAVAILABLE, "unavailable", "Service temporarily unavailable.", null);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorResponse> invalid(MethodArgumentNotValidException e) {
        List<ErrorResponse.Detail> details = e.getBindingResult().getFieldErrors().stream()
                .map(f -> new ErrorResponse.Detail(f.getField(), "invalid"))
                .toList();
        return respond(HttpStatus.BAD_REQUEST, "invalid_request", "The request is not valid.", details);
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MissingServletRequestParameterException.class,
        MethodArgumentTypeMismatchException.class
    })
    ResponseEntity<ErrorResponse> badRequest(Exception e) {
        return respond(HttpStatus.BAD_REQUEST, "invalid_request", "The request is not valid.", null);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ErrorResponse> notFound(NoResourceFoundException e) {
        return respond(HttpStatus.NOT_FOUND, "not_found", "Not found.", null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ErrorResponse> methodNotAllowed(HttpRequestMethodNotSupportedException e) {
        return respond(HttpStatus.METHOD_NOT_ALLOWED, "invalid_request", "Method not allowed.", null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> internal(Exception e) {
        // Class name only: the message could contain user data.
        log.error("Unhandled exception of type {}", e.getClass().getName());
        return respond(HttpStatus.INTERNAL_SERVER_ERROR, "internal", "Something went wrong.", null);
    }

    private static ResponseEntity<ErrorResponse> respond(
            HttpStatus status, String code, String message, List<ErrorResponse.Detail> details) {
        return ResponseEntity.status(status).body(new ErrorResponse(code, message, details));
    }
}
