package app.plateandbar.api.auth;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The web app's own origins, for cookie mode (ADR 006, contract 0.1.17): the only origins that may send
 * {@code X-Auth-Transport: cookie}. Deliberately separate from {@code app.cors.allowed-origins}: another page that
 * calls the API from a browser (the website's account-deletion page) may be a CORS origin and on the same site as the
 * API, so {@code SameSite=Strict} would still send it the cookie. Empty means cookie mode is refused for everyone.
 * Exact origins only, compared as text.
 */
@ConfigurationProperties(prefix = "app.auth")
public record CookieModeProperties(List<String> cookieOrigins) {
    public CookieModeProperties {
        cookieOrigins = cookieOrigins == null
                ? List.of()
                : cookieOrigins.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
        if (cookieOrigins.contains("*") || cookieOrigins.contains("null")) {
            // "null" is what sandboxed frames and file pages send as Origin: allowing it would trust any of them.
            throw new IllegalStateException("AUTH_COOKIE_ORIGINS must list exact origins, not * or null");
        }
    }
}
