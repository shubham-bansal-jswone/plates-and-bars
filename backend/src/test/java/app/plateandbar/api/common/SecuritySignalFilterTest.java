package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** The flood cap, the path template and the 429 rule of {@link SecuritySignalFilter}, without a Spring context. */
class SecuritySignalFilterTest {

    private final app.plateandbar.api.support.MutableClock clock =
            new app.plateandbar.api.support.MutableClock(Instant.parse("2026-10-17T10:00:00Z"));
    private final SecuritySignalFilter filter = new SecuritySignalFilter(clock, new ClientIpResolver(List.of()), 1000);
    private Logger security;
    private ListAppender<ILoggingEvent> lines;

    @BeforeEach
    void capture() {
        security = (Logger) LoggerFactory.getLogger("app.plateandbar.security");
        security.setLevel(Level.INFO);
        lines = new ListAppender<>();
        lines.start();
        security.addAppender(lines);
    }

    @AfterEach
    void release() {
        security.detachAppender(lines);
        security.setLevel(null);
    }

    private void run(String ip, String uri, int status, String bucket) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", uri);
        req.setRemoteAddr(ip);
        if (bucket != null) {
            req.setAttribute(SecuritySignalFilter.BUCKET, bucket);
        }
        filter.doFilter(req, new MockHttpServletResponse(), (rq, rs) -> ((jakarta.servlet.http.HttpServletResponse) rs).setStatus(status));
    }

    private long count(String startsWith) {
        return lines.list.stream().filter(e -> e.getFormattedMessage().startsWith(startsWith)).count();
    }

    @Test
    void refusedAuthFromOneAddressIsCappedPerMinuteAndOtherAddressesAreIndependent() throws Exception {
        for (int i = 0; i < 40; i++) {
            run("192.0.2.1", "/api/v1/me", i % 2 == 0 ? 401 : 403, null);
        }
        assertThat(count("Auth refused")).isEqualTo(5);
        run("192.0.2.2", "/api/v1/me", 401, null);
        assertThat(count("Auth refused")).isEqualTo(6);
        clock.advance(Duration.ofMinutes(1));
        run("192.0.2.1", "/api/v1/me", 401, null);
        assertThat(count("Auth refused")).isEqualTo(7);
    }

    @Test
    void successesAndOtherStatusesLogNothing() throws Exception {
        run("192.0.2.3", "/api/v1/me", 200, null);
        run("192.0.2.3", "/api/v1/me", 404, null);
        run("192.0.2.3", "/api/v1/me", 500, null);
        run("192.0.2.3", "/api/v1/me", 429, null); // a 429 with no bucket (for example an AI quota) is not a rate-limit hit
        assertThat(lines.list).isEmpty();
    }

    @Test
    void rateLimitLineIsOncePerBucketAndAddress() throws Exception {
        for (int i = 0; i < 10; i++) {
            run("192.0.2.4", "/api/v1/auth/email/start", 429, "email-start-ip");
        }
        run("192.0.2.4", "/api/v1/auth/email/verify", 429, "email-verify-ip");
        assertThat(count("Rate limit hit")).isEqualTo(2);
    }

    @Test
    void pathTemplateKeepsOnlyPlainWords() {
        assertThat(tpl("/api/v1/sync/foods/123e4567-e89b-12d3-a456-426614174000")).isEqualTo("/api/v1/sync/foods/{id}");
        assertThat(tpl("/api/v1/me/asha%40example.com")).isEqualTo("/api/v1/me/{id}");
        assertThat(tpl("/api/v1/x;jsessionid=abc")).isEqualTo("/api/v1/{id}");
        assertThat(tpl("/")).isEqualTo("/");
        assertThat(tpl("/a/b/c/d/e/f/g/h/i/j")).isEqualTo("/a/b/c/d/e/f/g/h/...");
        assertThat(tpl("/" + "a".repeat(33))).isEqualTo("/{id}");
    }

    private static String tpl(String uri) {
        return SecuritySignalFilter.template(new MockHttpServletRequest("GET", uri));
    }
}
