package app.plateandbar.api.ratelimit;

import app.plateandbar.api.common.ErrorResponse;
import app.plateandbar.api.common.SecuritySignalFilter;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Request-level limits, run after {@code JwtAuthFilter}. Public /auth and /content endpoints (which ignore any bearer token) are limited per client IP
 * (one shared bucket, plus a stricter one for email start and verify). The public /foods/barcode/ endpoint (also ignores
 * any bearer token) has its own per-IP scope, {@code barcode-ip}, even for a signed-in request. Authenticated requests are limited per
 * user id. Anything else without a valid token (it will get 401) falls back to the per-IP bucket, and so does
 * a request whose token {@code JwtAuthFilter} rejected (it calls {@link #limitByIp}). /health has its own generous
 * per-IP limit. Per-address limits live in the auth service because they need the request body.
 * A refusal records only the scope name (request attribute {@link SecuritySignalFilter#BUCKET}, logged by that filter),
 * never the IP, address or user id.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    /** The path as the router sees it (percent-decoded), so /auth/email/%76erify cannot dodge its bucket. */
    private static final org.springframework.web.util.UrlPathHelper PATHS = org.springframework.web.util.UrlPathHelper.defaultInstance;
    private static final String AUTH_PREFIX = "/api/v1/auth/";
    private static final String CONTENT_PREFIX = "/api/v1/content/";
    private static final String BARCODE_PREFIX = "/api/v1/foods/barcode/";
    private static final String HEALTH = "/api/v1/health";

    private final RateLimiter limiter;
    private final ClientIpResolver ips;
    private final RateLimitProperties props;
    private final ObjectMapper mapper;

    public RateLimitFilter(RateLimiter limiter, ClientIpResolver ips, RateLimitProperties props, ObjectMapper mapper) {
        this.limiter = limiter;
        this.ips = ips;
        this.props = props;
        this.mapper = mapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String scope;
        try {
            String path = PATHS.getPathWithinApplication(request);
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (!path.startsWith(AUTH_PREFIX) && !path.startsWith(CONTENT_PREFIX) && !path.startsWith(BARCODE_PREFIX)
                    && !path.equals(HEALTH) && auth != null && auth.isAuthenticated()
                    && !(auth instanceof AnonymousAuthenticationToken)) {
                scope = "user";
                try {
                    limiter.consume(scope, auth.getName(), props.getAuthenticatedPerUser());
                } catch (RateLimitedException e) {
                    request.setAttribute(SecuritySignalFilter.BUCKET, scope);
                    throw e;
                }
            } else {
                scope = limitByIp(request);
            }
        } catch (RateLimitedException e) {
            // Already logged (once) where it was raised.
            writeRateLimited(mapper, response, e);
            return;
        }
        chain.doFilter(request, response);
    }

    /**
     * Per-IP limits for the request's path. Also called for requests whose bearer token was rejected, so that
     * garbage tokens cannot be replayed for free. Returns the last scope consumed (for the log line on refusal).
     */
    public String limitByIp(HttpServletRequest request) {
        String path = PATHS.getPathWithinApplication(request);
        String ip = ips.resolve(request);
        if (path.equals(HEALTH)) {
            limiter.consume("health-ip", ip, props.getHealthPerIp());
            return "health-ip";
        }
        if (path.startsWith(BARCODE_PREFIX)) {
            // Its own scope and nothing else: invalid codes count (the check comes before validation), a signed-in caller
            // gets no per-user bucket here, and scans neither use up nor are starved by the sign-in allowance.
            try {
                limiter.consume("barcode-ip", ip, props.getBarcodePerIp());
            } catch (RateLimitedException e) {
                request.setAttribute(SecuritySignalFilter.BUCKET, "barcode-ip");
                throw e;
            }
            return "barcode-ip";
        }
        String scope = "public-ip";
        try {
            limiter.consume(scope, ip, props.getPublicPerIp());
            if (path.equals(AUTH_PREFIX + "email/start")) {
                scope = "email-start-ip";
                limiter.consume(scope, ip, props.getEmailStartPerIp());
            } else if (path.equals(AUTH_PREFIX + "email/verify")) {
                scope = "email-verify-ip";
                limiter.consume(scope, ip, props.getEmailVerifyPerIp());
            }
        } catch (RateLimitedException e) {
            request.setAttribute(SecuritySignalFilter.BUCKET, scope);
            throw e;
        }
        return scope;
    }

    public static void writeRateLimited(ObjectMapper mapper, HttpServletResponse response, RateLimitedException e)
            throws IOException {
        response.setStatus(429);
        response.setHeader("Retry-After", Long.toString(e.retryAfterSeconds()));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), ErrorResponse.of(e.code(), e.getMessage()));
    }
}
