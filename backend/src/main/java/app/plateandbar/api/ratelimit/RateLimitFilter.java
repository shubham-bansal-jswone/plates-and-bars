package app.plateandbar.api.ratelimit;

import app.plateandbar.api.common.ErrorResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Request-level limits, run after {@code JwtAuthFilter}. Public /auth endpoints are limited per client IP
 * (one shared bucket, plus a stricter one for email start and verify). Authenticated requests are limited per
 * user id. Anything else without a valid token (it will get 401) falls back to the per-IP bucket. /health is
 * never limited. Per-address limits live in the auth service because they need the request body.
 * Refusals log only the scope name, never the IP, address or user id.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);
    private static final String AUTH_PREFIX = "/api/v1/auth/";

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
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getRequestURI().equals("/api/v1/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String scope = "";
        try {
            String path = request.getRequestURI();
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (!path.startsWith(AUTH_PREFIX) && auth != null && auth.isAuthenticated()) {
                scope = "user";
                limiter.consume(scope, auth.getName(), props.getAuthenticatedPerUser());
            } else {
                String ip = ips.resolve(request);
                scope = "public-ip";
                limiter.consume(scope, ip, props.getPublicPerIp());
                if (path.equals(AUTH_PREFIX + "email/start")) {
                    scope = "email-start-ip";
                    limiter.consume(scope, ip, props.getEmailStartPerIp());
                } else if (path.equals(AUTH_PREFIX + "email/verify")) {
                    scope = "email-verify-ip";
                    limiter.consume(scope, ip, props.getEmailVerifyPerIp());
                }
            }
        } catch (RateLimitedException e) {
            log.debug("Rate limit hit: {}", scope);
            response.setStatus(429);
            response.setHeader("Retry-After", Long.toString(e.retryAfterSeconds()));
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(response.getOutputStream(), ErrorResponse.of(e.code(), e.getMessage()));
            return;
        }
        chain.doFilter(request, response);
    }
}
