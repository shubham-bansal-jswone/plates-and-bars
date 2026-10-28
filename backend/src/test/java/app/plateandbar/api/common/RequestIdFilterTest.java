package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestIdFilterTest {

    private final RequestIdFilter filter = new RequestIdFilter();

    /** Runs the filter; returns the response and the MDC id seen inside the chain. */
    private static Object[] run(String incoming, int status) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/health");
        if (incoming != null) req.addHeader("X-Request-Id", incoming);
        MockHttpServletResponse res = new MockHttpServletResponse();
        AtomicReference<String> seen = new AtomicReference<>();
        new RequestIdFilter().doFilter(req, res, (rq, rs) -> {
            seen.set(MDC.get("requestId"));
            ((jakarta.servlet.http.HttpServletResponse) rs).setStatus(status);
        });
        return new Object[] {res, seen.get()};
    }

    @Test
    void generatesAUuidWhenAbsent() throws Exception {
        Object[] r = run(null, 200);
        String id = ((MockHttpServletResponse) r[0]).getHeader("X-Request-Id");
        assertThat(UUID.fromString(id)).isNotNull();
        assertThat(r[1]).isEqualTo(id);
    }

    @Test
    void echoesAValidId() throws Exception {
        Object[] r = run("abc-123_X.y", 200);
        assertThat(((MockHttpServletResponse) r[0]).getHeader("X-Request-Id")).isEqualTo("abc-123_X.y");
        assertThat(r[1]).isEqualTo("abc-123_X.y");
    }

    @Test
    void replacesInvalidIds() throws Exception {
        for (String bad : new String[] {"a".repeat(65), "has space", "new\r\nline", "a@b.com", "<x>", ""}) {
            Object[] r = run(bad, 200);
            String id = ((MockHttpServletResponse) r[0]).getHeader("X-Request-Id");
            assertThat(id).isNotEqualTo(bad);
            assertThat(UUID.fromString(id)).isNotNull();
        }
        assertThat(((MockHttpServletResponse) run("a".repeat(64), 200)[0]).getHeader("X-Request-Id")).hasSize(64);
    }

    @Test
    void headerIsOnErrorResponsesToo() throws Exception {
        for (int status : new int[] {401, 429, 500}) {
            MockHttpServletResponse res = (MockHttpServletResponse) run("req-1", status)[0];
            assertThat(res.getStatus()).isEqualTo(status);
            assertThat(res.getHeader("X-Request-Id")).isEqualTo("req-1");
        }
    }

    @Test
    void mdcIsClearedAfterTheRequestEvenOnFailure() throws Exception {
        run("req-2", 200);
        assertThat(MDC.get("requestId")).isNull();
        try {
            filter.doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), (rq, rs) -> {
                throw new java.io.IOException("boom");
            });
        } catch (java.io.IOException expected) {
            // the filter must not swallow it
        }
        assertThat(MDC.get("requestId")).isNull();
    }

    @Test
    void filtersAsyncAndErrorDispatchesToo() throws Exception {
        for (jakarta.servlet.DispatcherType type : new jakarta.servlet.DispatcherType[] {
                jakarta.servlet.DispatcherType.ASYNC, jakarta.servlet.DispatcherType.ERROR}) {
            MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/me/export");
            req.setDispatcherType(type);
            AtomicReference<String> seen = new AtomicReference<>();
            filter.doFilter(req, new MockHttpServletResponse(), (rq, rs) -> seen.set(MDC.get("requestId")));
            assertThat(seen.get()).as(type.name()).isNotNull();
        }
    }

    @Test
    void aRedispatchKeepsTheIdOfTheFirstPass() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/x"); // client sent no id
        MockHttpServletResponse first = new MockHttpServletResponse();
        filter.doFilter(req, first, (rq, rs) -> { });
        String id = first.getHeader("X-Request-Id");

        req.setDispatcherType(jakarta.servlet.DispatcherType.ERROR);
        MockHttpServletResponse second = new MockHttpServletResponse();
        AtomicReference<String> seen = new AtomicReference<>();
        filter.doFilter(req, second, (rq, rs) -> seen.set(MDC.get("requestId")));
        assertThat(second.getHeader("X-Request-Id")).isEqualTo(id);
        assertThat(seen.get()).isEqualTo(id);
    }
}
