package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.converter.HttpMessageNotReadableException;

class ApiExceptionHandlerCauseTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    private static HttpMessageNotReadableException wrapping(Throwable cause) {
        return new HttpMessageNotReadableException("x", cause, new org.springframework.http.server.ServletServerHttpRequest(
                new org.springframework.mock.web.MockHttpServletRequest()));
    }

    @Test
    void onlyTheGuardsTooLargeIsUnwrappedAndACauseCycleTerminates() {
        var tooLarge = handler.badRequest(wrapping(new RequestSizeGuardFilter.TooLarge()));
        assertThat(tooLarge.getBody().details().get(0).issue()).isEqualTo("too_large");
        // Any other ApiException in the cause chain is not surfaced.
        var other = handler.badRequest(wrapping(new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "unauthorized", "m")));
        assertThat(other.getStatusCode().value()).isEqualTo(400);
        assertThat(other.getBody().details()).isNull();
        // A cycle of causes ends instead of looping.
        RuntimeException a = new RuntimeException();
        RuntimeException b = new RuntimeException(a);
        a.initCause(b);
        assertThat(handler.badRequest(wrapping(a)).getStatusCode().value()).isEqualTo(400);
    }
}
