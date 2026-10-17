package app.plateandbar.api.common;

import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * A ceiling on every request body under {@code /api}, the same one sync uses ({@code app.sync.max-body-bytes},
 * default 2 MB), so no endpoint can buffer an unbounded body even if a future handler forgets to bound its own
 * read. A declared {@code Content-Length} over the limit is refused before anything is read; a body with no
 * length (chunked) is cut off by a counting stream the moment it passes the limit. Both answer 400
 * {@code invalid_request} with detail {@code too_large}. Runs before security, CORS and rate limiting, so an oversized body gets this 400 before any 401 or 429, and an
 * unauthenticated caller's oversized body is never read.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestSizeGuardFilter extends OncePerRequestFilter {

    private final long maxBytes;
    private final ObjectMapper json;

    public RequestSizeGuardFilter(@Value("${app.sync.max-body-bytes:2097152}") long maxBytes, ObjectMapper json) {
        this.maxBytes = maxBytes;
        this.json = json;
    }

    /** 400 {@code invalid_request}, detail {@code too_large}: thrown by the counting stream. */
    public static final class TooLarge extends ApiException {
        TooLarge() {
            super(HttpStatus.BAD_REQUEST, "invalid_request", "The request is not valid.",
                    List.of(new ErrorResponse.Detail("", "too_large")));
        }
    }

    static ApiException tooLarge() {
        return new TooLarge();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > maxBytes) {
            ApiException e = tooLarge();
            response.setStatus(e.status().value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader("Connection", "close"); // the unread body is not worth draining
            json.writeValue(response.getOutputStream(), new ErrorResponse(e.code(), e.getMessage(), e.details()));
            return;
        }
        chain.doFilter(new Limited(request, maxBytes), response);
    }

    private static final class Limited extends HttpServletRequestWrapper {
        private final long max;
        private ServletInputStream stream;

        Limited(HttpServletRequest request, long max) {
            super(request);
            this.max = max;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) {
                stream = new Counting(super.getInputStream(), max);
            }
            return stream;
        }

        @Override
        public java.io.BufferedReader getReader() throws IOException {
            return new java.io.BufferedReader(new java.io.InputStreamReader(getInputStream(),
                    getCharacterEncoding() == null ? java.nio.charset.StandardCharsets.UTF_8
                            : java.nio.charset.Charset.forName(getCharacterEncoding())));
        }
    }

    /** Throws the 400 once more than {@code max} bytes have been read through it. */
    private static final class Counting extends ServletInputStream {
        private final ServletInputStream in;
        private final long max;
        private long count;

        Counting(ServletInputStream in, long max) {
            this.in = in;
            this.max = max;
        }

        private void add(long n) {
            if (n > 0) {
                count += n;
                if (count > max) {
                    throw tooLarge();
                }
            }
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) {
                add(1);
            }
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n = in.read(b, off, len);
            add(n);
            return n;
        }

        @Override
        public boolean isFinished() {
            return in.isFinished();
        }

        @Override
        public boolean isReady() {
            return in.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            in.setReadListener(listener);
        }
    }
}
