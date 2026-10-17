package app.plateandbar.api.common;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties.Limit;
import app.plateandbar.api.ratelimit.RateLimitedException;
import app.plateandbar.api.ratelimit.RateLimiter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Detection signals (#714): one INFO line for each refused request (401 or 403, except routine {@code token_expired}, which is DEBUG) and each rate-limit hit (429), written
 * after the response status is known, so every place that refuses (the JWT filter, the security entry point, the
 * rate-limit filter, the Origin check, controllers) is covered by one filter that wraps them.
 *
 * <p>A line carries only the status, the method, a path template and a reason code (or the bucket name for a 429). Never a
 * header, query string, body, token, e-mail address, user id or IP address. To stop a flood from flooding the log, lines are
 * limited per client IP (the IP is only a hashed cache key inside {@link RateLimiter}, never written): a few refusals
 * per minute per address, one rate-limit line per bucket and address per minute.
 */
public class SecuritySignalFilter extends OncePerRequestFilter {

    /** Request attribute: reason code of a refusal, set where the cause is known; defaults to the status name. */
    public static final String REASON = SecuritySignalFilter.class.getName() + ".reason";
    /** Request attribute: name of the rate-limit bucket that refused the request. */
    public static final String BUCKET = SecuritySignalFilter.class.getName() + ".bucket";

    private static final Logger log = LoggerFactory.getLogger("app.plateandbar.security");
    private static final Limit REFUSED_PER_IP = new Limit(5, Duration.ofMinutes(1));
    private static final Limit RATE_LIMIT_PER_IP_AND_BUCKET = new Limit(1, Duration.ofMinutes(1));
    private static final Pattern WORD = Pattern.compile("[a-z]+([-_][a-z]+)*");
    private static final Pattern SAFE_CODE = Pattern.compile("[a-z_]{1,40}");
    private static final int MAX_SEGMENTS = 8;

    private final RateLimiter limiter;
    private final ClientIpResolver ips;

    public SecuritySignalFilter(Clock clock, ClientIpResolver ips, long maxTrackedKeys) {
        this.limiter = new RateLimiter(clock, maxTrackedKeys);
        this.ips = ips;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } finally {
            signal(request, response.getStatus());
        }
    }

    private void signal(HttpServletRequest request, int status) {
        try {
            if (status == 401 || status == 403) {
                String reason = reason(request, status);
                if (reason.equals("token_expired")) {
                    // Every active client hits this once per access-token lifetime: routine, not a signal. DEBUG, and it
                    // must not spend the per-address allowance that real guessing (unauthorized, invalid_code) needs.
                    log.debug("Auth refused (status={}, method={}, path={}, reason={})", status, method(request), template(request), reason);
                    return;
                }
                limiter.consume("refused-auth", ips.resolve(request), REFUSED_PER_IP);
                log.info("Auth refused (status={}, method={}, path={}, reason={})", status, method(request), template(request), reason);
            } else if (status == 429 && request.getAttribute(BUCKET) instanceof String bucket && SAFE_CODE.matcher(bucket.replace('-', '_')).matches()) {
                limiter.consume("rate-limit-hit:" + bucket, ips.resolve(request), RATE_LIMIT_PER_IP_AND_BUCKET);
                log.info("Rate limit hit (bucket={}, path={})", bucket, template(request));
            }
        } catch (RateLimitedException suppressed) {
            // Over this address's allowance: the line is dropped on purpose.
        } catch (RuntimeException e) {
            // A signal must never break a request.
            log.debug("Security signal not written ({})", e.getClass().getSimpleName());
        }
    }

    private static String method(HttpServletRequest request) {
        String m = request.getMethod();
        return m != null && m.matches("[A-Z]{3,7}") ? m : "OTHER";
    }

    private static String reason(HttpServletRequest request, int status) {
        if (request.getAttribute(REASON) instanceof String code && SAFE_CODE.matcher(code).matches()) {
            return code;
        }
        return status == 401 ? "unauthorized" : "forbidden";
    }

    /**
     * The path with anything that is not a plain lower-case word replaced by {@code {id}}, so ids, UUIDs, encoded text
     * and junk a caller invents never reach the log. {@code v1} is the one word with a digit.
     */
    static String template(HttpServletRequest request) {
        String uri = request.getRequestURI();
        if (uri == null || uri.isEmpty()) {
            return "/";
        }
        StringBuilder out = new StringBuilder();
        String[] parts = uri.split("/", -1);
        int kept = 0;
        for (String part : parts) {
            if (part.isEmpty()) {
                continue;
            }
            if (kept == MAX_SEGMENTS) {
                out.append("/...");
                break;
            }
            kept++;
            boolean plain = part.length() <= 32 && (part.equals("v1") || WORD.matcher(part).matches());
            out.append('/').append(plain ? part : "{id}");
        }
        return out.length() == 0 ? "/" : out.toString();
    }
}
