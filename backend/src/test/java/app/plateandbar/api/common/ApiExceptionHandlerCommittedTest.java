package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

/** Once a response is committed (a streamed export), an Error body cannot be appended: the failure must propagate. */
class ApiExceptionHandlerCommittedTest {

    final ApiExceptionHandler handler = new ApiExceptionHandler();

    @Test
    void aCommittedResponseRethrowsSoTheContainerAbortsTheConnection() {
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setCommitted(true);
        IllegalStateException failure = new IllegalStateException("x");
        assertThatThrownBy(() -> handler.internal(failure, response)).isSameAs(failure);
    }

    @Test
    void anUncommittedResponseStillGetsTheErrorBody() throws Exception {
        assertThat(handler.internal(new IllegalStateException("x"), new MockHttpServletResponse()).getStatusCode().value())
                .isEqualTo(500);
    }
}
