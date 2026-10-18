package app.plateandbar.api.common;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * The container's error page, replacing Boot's {@code BasicErrorController} (which answers with
 * {@code {timestamp,status,error,path}}). A failure that reaches the container still gets the contract's
 * {@code Error} shape, and when the response is already committed (a streamed export that failed, #349) nothing
 * is written: the container aborts the connection and no body is appended to the unfinished document.
 */
@Controller
public class ApiErrorController implements ErrorController {

    @RequestMapping(path = "${server.error.path:/error}")
    public ResponseEntity<ErrorResponse> error(HttpServletRequest request, HttpServletResponse response) {
        if (response.isCommitted()) {
            return null;
        }
        Object attr = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        HttpStatus status = attr instanceof Integer code && HttpStatus.resolve(code) != null
                ? HttpStatus.resolve(code)
                : HttpStatus.INTERNAL_SERVER_ERROR;
        String code = switch (status) {
            case UNAUTHORIZED -> "unauthorized";
            case FORBIDDEN -> "forbidden";
            case NOT_FOUND -> "not_found";
            default -> status.is4xxClientError() ? "invalid_request" : "internal";
        };
        String message = status.is4xxClientError() ? "The request is not valid." : "Something went wrong.";
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ErrorResponse.of(code, message));
    }
}
