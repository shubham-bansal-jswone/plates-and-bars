package app.plateandbar.api.ai;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code /api/v1/ai/*}. The user is always the token's principal. Bodies are never logged. */
@RestController
@RequestMapping("/api/v1/ai")
public class AiController {

    public record Features(
            @JsonProperty("describe_meal") boolean describeMeal,
            @JsonProperty("ask_why") boolean askWhy,
            @JsonProperty("weekly_summary") boolean weeklySummary) {}

    public record StatusResponse(@JsonProperty("features") Features features, @JsonProperty("quota") AiQuota quota) {}

    private final AiQuotaService quotas;
    private final RateLimiter limiter;
    private final ClientIpResolver ips;
    private final RateLimitProperties limits;

    AiController(AiQuotaService quotas, RateLimiter limiter, ClientIpResolver ips, RateLimitProperties limits) {
        this.quotas = quotas;
        this.limiter = limiter;
        this.ips = ips;
        this.limits = limits;
    }

    /** Only the per-IP limit applies here; it is not part of the 5-per-minute AI limit. */
    @GetMapping(path = "/status", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StatusResponse> status(Authentication auth, HttpServletRequest request) {
        limiter.consume("ai-ip", ips.resolve(request), limits.getAiPerIp());
        Features f = new Features(
                quotas.isOn(AiFeature.DESCRIBE_MEAL), quotas.isOn(AiFeature.ASK_WHY), quotas.isOn(AiFeature.WEEKLY_SUMMARY));
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new StatusResponse(f, quotas.quota(auth.getName())));
    }
}
