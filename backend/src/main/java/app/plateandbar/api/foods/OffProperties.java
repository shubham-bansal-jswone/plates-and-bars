package app.plateandbar.api.foods;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Open Food Facts barcode lookup settings ({@code app.off.*}, ADR 009). Off by default: the feature stays dark until the
 * owner has filled in Open Food Facts' API usage form and chosen the contact address. A null value takes the default.
 *
 * @param enabled false (default): {@code GET /foods/barcode/{code}} answers 503 {@code upstream_unavailable} and nothing is called
 * @param baseUrl the Open Food Facts host (fixed config, never taken from a request); default https://world.openfoodfacts.org
 * @param contact the address in the User-Agent ({@code PlateAndBar/<version> (<contact>)}); required while enabled
 * @param upstreamPerMinute the one limit shared by every call to Open Food Facts (they allow 15; default 12)
 */
@ConfigurationProperties(prefix = "app.off")
public record OffProperties(
        Boolean enabled,
        String baseUrl,
        String contact,
        Duration connectTimeout,
        Duration readTimeout,
        Duration retryBackoff,
        Integer maxBodyBytes,
        Duration hitTtl,
        Duration missTtl,
        Integer upstreamPerMinute) {

    public OffProperties {
        enabled = enabled != null && enabled;
        baseUrl = baseUrl == null || baseUrl.isBlank() ? "https://world.openfoodfacts.org" : baseUrl.trim().replaceAll("/+$", "");
        contact = contact == null ? "" : contact.trim();
        connectTimeout = connectTimeout == null ? Duration.ofSeconds(3) : connectTimeout;
        readTimeout = readTimeout == null ? Duration.ofSeconds(5) : readTimeout;
        retryBackoff = retryBackoff == null ? Duration.ofMillis(250) : retryBackoff;
        maxBodyBytes = maxBodyBytes == null ? 256 * 1024 : maxBodyBytes;
        hitTtl = hitTtl == null ? Duration.ofDays(30) : hitTtl;
        missTtl = missTtl == null ? Duration.ofHours(24) : missTtl;
        upstreamPerMinute = upstreamPerMinute == null ? 12 : upstreamPerMinute;
        if (enabled) {
            if (contact.isEmpty()) {
                throw new IllegalStateException("OFF_CONTACT_EMAIL is required while the barcode lookup is enabled (OFF_ENABLED)");
            }
            // It goes into a header: printable ASCII only, so it cannot carry a line break.
            if (contact.length() > 100 || !contact.chars().allMatch(c -> c >= 0x20 && c < 0x7F)) {
                throw new IllegalStateException("OFF_CONTACT_EMAIL must be at most 100 printable ASCII characters");
            }
            URI uri = URI.create(baseUrl);
            if (uri.getHost() == null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                throw new IllegalStateException("OFF_BASE_URL must be an http(s) URL");
            }
        }
    }
}
