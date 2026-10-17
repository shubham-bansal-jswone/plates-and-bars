package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import java.io.ByteArrayInputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestSizeGuardFilterTest {

    private final RequestSizeGuardFilter filter = new RequestSizeGuardFilter(100, new ObjectMapper());

    private static ServletInputStream stream(byte[] data) {
        ByteArrayInputStream in = new ByteArrayInputStream(data);
        return new ServletInputStream() {
            @Override public int read() { return in.read(); }
            @Override public boolean isFinished() { return in.available() == 0; }
            @Override public boolean isReady() { return true; }
            @Override public void setReadListener(ReadListener l) {}
        };
    }

    @Test
    void aDeclaredLengthOverTheLimitIsRefusedWithoutTouchingTheBody() throws Exception {
        AtomicBoolean read = new AtomicBoolean();
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/ai/describe-meal") {
            @Override public ServletInputStream getInputStream() { read.set(true); return stream(new byte[0]); }
        };
        req.setContent(new byte[101]);
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, res, chain);
        assertThat(res.getStatus()).isEqualTo(400);
        assertThat(res.getContentAsString()).contains("\"code\":\"invalid_request\"").contains("\"issue\":\"too_large\"");
        assertThat(chain.getRequest()).as("chain not reached").isNull();
        assertThat(read).isFalse();
    }

    @Test
    void aChunkedBodyIsCutOffOnceItPassesTheLimit() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/sync") {
            @Override public ServletInputStream getInputStream() { return stream(new byte[1000]); }
            @Override public long getContentLengthLong() { return -1; } // no Content-Length
        };
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, res, chain);
        var seen = (jakarta.servlet.http.HttpServletRequest) chain.getRequest();
        assertThat(seen.getInputStream().readNBytes(100)).hasSize(100);
        assertThatThrownBy(() -> seen.getInputStream().readNBytes(10))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status().value()).isEqualTo(400);
                    assertThat(e.details().get(0).issue()).isEqualTo("too_large");
                });
    }

    @Test
    void aBodyAtTheLimitAndNonApiPathsPass() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/sync");
        req.setContent(new byte[100]);
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, new MockHttpServletResponse(), chain);
        assertThat(((jakarta.servlet.http.HttpServletRequest) chain.getRequest()).getInputStream().readAllBytes())
                .hasSize(100);
        MockHttpServletRequest other = new MockHttpServletRequest("POST", "/elsewhere");
        other.setContent(new byte[500]);
        MockFilterChain c2 = new MockFilterChain();
        filter.doFilter(other, new MockHttpServletResponse(), c2);
        assertThat(c2.getRequest()).isSameAs(other);
    }
}
