package app.plateandbar.api.auth;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import app.plateandbar.api.ratelimit.RateLimitFilter;
import app.plateandbar.api.ratelimit.RateLimitedException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.function.Consumer;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Validates the bearer access JWT on every request except /health, /auth/* and /content/*, which ignore Authorization entirely. A bad token is
 * answered here with 401 {@code token_expired} or {@code unauthorized}; a missing token falls
 * through to the security entry point (401 {@code unauthorized}). A valid token whose user no longer exists is
 * 401 {@code unauthorized} too, except for DELETE /me. The principal is the user id.
 */
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwt;
    private final ObjectMapper mapper;
    private final Consumer<HttpServletRequest> onRejectedToken;
    private final UserExistenceCheck users;

    /**
     * @param onRejectedToken called for every request whose bearer token is rejected, before the 401 is sent;
     *     it may throw {@link RateLimitedException} so that garbage tokens count against the per-IP limit.
     */
    public JwtAuthFilter(
            JwtService jwt,
            ObjectMapper mapper,
            Consumer<HttpServletRequest> onRejectedToken,
            UserExistenceCheck users) {
        this.users = users;
        this.jwt = jwt;
        this.mapper = mapper;
        this.onRejectedToken = onRejectedToken;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.equals("/api/v1/health") || path.startsWith("/api/v1/auth/") || path.startsWith("/api/v1/content/");
    }

    private static final class UserLookupFailedException extends RuntimeException {
        UserLookupFailedException(Throwable cause) {
            super("user lookup failed", cause);
        }
    }

    private boolean userExists(String userId) {
        try {
            return users.exists(userId);
        } catch (DataAccessException e) {
            throw new UserLookupFailedException(e);
        }
    }

    private static boolean isDeleteAccount(HttpServletRequest request) {
        return "DELETE".equals(request.getMethod()) && request.getRequestURI().equals("/api/v1/me");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            try {
                String userId = jwt.verify(header.substring(7).trim());
                // A token outlives its account by up to 15 minutes; DELETE /me stays open so a repeat is 204.
                if (!isDeleteAccount(request) && !userExists(userId)) {
                    throw ApiException.sessionEnded();
                }
                SecurityContextHolder.getContext()
                        .setAuthentication(UsernamePasswordAuthenticationToken.authenticated(userId, null, List.of()));
            } catch (UserLookupFailedException e) {
                // The database cannot tell us whether the account exists: say so, never claim 401.
                SecurityContextHolder.clearContext();
                response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                mapper.writeValue(
                        response.getOutputStream(), ErrorResponse.of("unavailable", "Service temporarily unavailable."));
                return;
            } catch (ApiException e) {
                SecurityContextHolder.clearContext();
                try {
                    onRejectedToken.accept(request);
                } catch (RateLimitedException limited) {
                    RateLimitFilter.writeRateLimited(mapper, response, limited);
                    return;
                }
                response.setStatus(e.status().value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                mapper.writeValue(response.getOutputStream(), ErrorResponse.of(e.code(), e.getMessage()));
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
