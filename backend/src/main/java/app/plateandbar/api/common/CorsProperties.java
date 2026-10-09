package app.plateandbar.api.common;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Web app origins allowed to call the API from a browser. Empty means no cross-origin caller is allowed. */
@ConfigurationProperties(prefix = "app.cors")
public record CorsProperties(List<String> allowedOrigins) {
    public CorsProperties {
        allowedOrigins = allowedOrigins == null
                ? List.of()
                : allowedOrigins.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
        if (allowedOrigins.contains("*")) {
            throw new IllegalStateException("CORS_ALLOWED_ORIGINS must list exact origins, not *");
        }
    }
}
