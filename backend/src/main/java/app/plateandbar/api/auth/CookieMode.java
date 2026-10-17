package app.plateandbar.api.auth;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;
import java.util.Set;
import org.springframework.web.util.UrlPathHelper;

/**
 * Cookie mode for the web app's refresh token (ADR 006, contract 0.1.17). Selected only by the exact request header
 * {@code X-Auth-Transport: cookie}; any other value, or no header, is body mode and the cookie is never read or set.
 * The token value never leaves these methods except into the {@code Set-Cookie} header and back out of the request.
 */
final class CookieMode {
    static final String HEADER = "X-Auth-Transport";
    static final String VALUE = "cookie";
    static final String COOKIE_NAME = "__Secure-pb_refresh";
    static final String COOKIE_PATH = "/api/v1/auth/refresh";
    static final String AUTH_PREFIX = "/api/v1/auth/";
    /** The four endpoints that honour the header; /auth/email/start does not. */
    static final Set<String> PATHS = Set.of(
            "/api/v1/auth/google", "/api/v1/auth/email/verify", "/api/v1/auth/refresh", "/api/v1/auth/refresh/revoke");

    private CookieMode() {}

    /**
     * The request path as the router sees it (percent-decoded), not the raw URI: {@code /api/v1/auth/%72efresh} reaches
     * the refresh endpoint, so it must not slip past a check that matches the raw text.
     */
    static String path(HttpServletRequest request) {
        return UrlPathHelper.defaultInstance.getPathWithinApplication(request);
    }

    static boolean requested(HttpServletRequest request) {
        return VALUE.equals(request.getHeader(HEADER));
    }

    /** The cookie's value, or empty when the browser sent none (or an empty one). */
    static Optional<String> token(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if (COOKIE_NAME.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
                    return Optional.of(c.getValue());
                }
            }
        }
        return Optional.empty();
    }

    /** {@code Set-Cookie} value that stores (or rotates) the token, exactly the attributes of the contract. */
    static String set(String token, long maxAgeSeconds) {
        return attributes(token, maxAgeSeconds);
    }

    /** {@code Set-Cookie} value that clears the cookie: same name, path and attributes, {@code Max-Age=0}. */
    static String clear() {
        return attributes("", 0);
    }

    private static String attributes(String value, long maxAge) {
        return COOKIE_NAME + "=" + value + "; Path=" + COOKIE_PATH + "; Max-Age=" + maxAge
                + "; HttpOnly; Secure; SameSite=Strict";
    }
}
