package app.plateandbar.api.auth;

import app.plateandbar.api.common.ErrorResponse;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The CSRF check of cookie mode: a request with {@code X-Auth-Transport: cookie} on one of the four endpoints must carry
 * an {@code Origin} exactly equal to a cookie-mode origin, else 403 {@code forbidden}. It runs after the rate limit and
 * before the body is read, so nothing is parsed, read from the cookie or changed for a refused request (the response
 * carries no {@code Set-Cookie}). Never logs; the header values are not echoed.
 */
class CookieModeOriginFilter extends OncePerRequestFilter {

    private final List<String> origins;
    private final ObjectMapper mapper;

    CookieModeOriginFilter(CookieModeProperties props, ObjectMapper mapper) {
        this.origins = props.cookieOrigins();
        this.mapper = mapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod())
                || !CookieMode.PATHS.contains(CookieMode.path(request))
                || !CookieMode.requested(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String origin = request.getHeader("Origin");
        if (origin == null || !origins.contains(origin)) {
            response.setStatus(HttpStatus.FORBIDDEN.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(
                    response.getOutputStream(), ErrorResponse.of("forbidden", "This request is not allowed from here."));
            return;
        }
        chain.doFilter(request, response);
    }
}
