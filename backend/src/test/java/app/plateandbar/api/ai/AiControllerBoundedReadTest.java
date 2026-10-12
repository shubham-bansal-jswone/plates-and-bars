package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.TestingAuthenticationToken;

/** H1: the AI controller reads at most 16 KB + 1 byte of a body that never ends. */
class AiControllerBoundedReadTest {

    /** A body that would be gigabytes long; counts what is actually pulled from it. */
    static final class Endless extends ServletInputStream {
        final AtomicLong served = new AtomicLong();

        @Override
        public int read() {
            if (served.incrementAndGet() > 4L * 1024 * 1024) {
                throw new AssertionError("read far past any sane limit");
            }
            return 'a';
        }

        @Override
        public int read(byte[] b, int off, int len) {
            if (served.addAndGet(len) > 4L * 1024 * 1024) {
                throw new AssertionError("read far past any sane limit");
            }
            java.util.Arrays.fill(b, off, off + len, (byte) 'a');
            return len;
        }

        @Override
        public boolean isFinished() {
            return false;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setReadListener(ReadListener l) {}
    }

    @Test
    void aBodyThatNeverEndsIsNotBufferedAndReachesTheServiceAsInvalid() throws IOException {
        AiService ai = mock(AiService.class);
        AiController c = new AiController(mock(AiQuotaService.class), ai, new ObjectMapper(),
                mock(RateLimiter.class), mock(ClientIpResolver.class), new RateLimitProperties());
        Endless body = new Endless();
        MockHttpServletRequest req = new MockHttpServletRequest() {
            @Override
            public ServletInputStream getInputStream() {
                return body;
            }
        };
        c.describeMeal(new TestingAuthenticationToken("u", "x"), req);
        verify(ai).describeMeal(any(), isNull());
        // readNBytes may ask for one buffer more than needed, but never an unbounded amount.
        assertThat(body.served.get()).isLessThanOrEqualTo(AiController.MAX_BODY_BYTES + 1 + 16 * 1024);
    }
}
