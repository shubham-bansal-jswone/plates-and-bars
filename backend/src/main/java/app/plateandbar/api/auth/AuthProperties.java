package app.plateandbar.api.auth;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Environment-supplied auth settings. Fixed policy values (TTLs, attempt limits) are constants in the code. */
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(String jwtSigningKey, List<String> googleClientIds) {
    public AuthProperties {
        googleClientIds = googleClientIds == null ? List.of() : googleClientIds.stream().filter(s -> !s.isBlank()).toList();
    }
}
