package app.plateandbar.api.ai;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    private static final int MAX_BODY_CHARS = 16 * 1024;

    AiController(AiQuotaService quotas, AiService ai, ObjectMapper json, RateLimiter limiter, ClientIpResolver ips,
            RateLimitProperties limits) {
        this.ai = ai;
        this.json = json;
        this.quotas = quotas;
        this.limiter = limiter;
        this.ips = ips;
        this.limits = limits;
    }

    private final AiService ai;
    private final ObjectMapper json;

    /** Order: token (filter), per-IP and per-user limits, then the service (switch, validation, quota, provider). */
    private ResponseEntity<ObjectNode> post(
            Authentication auth, HttpServletRequest request, String raw, AiCall call) {
        limiter.consume("ai-ip", ips.resolve(request), limits.getAiPerIp());
        limiter.consume("ai-user", auth.getName(), limits.getAiPerUser());
        JsonNode body = null;
        if (raw != null && raw.length() <= MAX_BODY_CHARS) {
            try {
                body = json.readTree(raw);
            } catch (Exception e) {
                body = null; // reported as a 400 by the service's validation, without the body
            }
        }
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(call.run(auth.getName(), body));
    }

    private interface AiCall {
        ObjectNode run(String userId, JsonNode body);
    }

    @PostMapping(path = "/describe-meal", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> describeMeal(Authentication a, HttpServletRequest r, @RequestBody String raw) {
        return post(a, r, raw, ai::describeMeal);
    }

    @PostMapping(path = "/ask-why", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> askWhy(Authentication a, HttpServletRequest r, @RequestBody String raw) {
        return post(a, r, raw, ai::askWhy);
    }

    @PostMapping(path = "/weekly-summary", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> weeklySummary(Authentication a, HttpServletRequest r, @RequestBody String raw) {
        return post(a, r, raw, ai::weeklySummary);
    }

    /** Only the per-IP limit applies here; it is not part of the 5-per-minute AI limit. */
    @GetMapping(path = "/status", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StatusResponse> status(Authentication auth, HttpServletRequest request) {
        limiter.consume("ai-ip", ips.resolve(request), limits.getAiPerIp());
        var on = quotas.features();
        Features f = new Features(
                on.get(AiFeature.DESCRIBE_MEAL), on.get(AiFeature.ASK_WHY), on.get(AiFeature.WEEKLY_SUMMARY));
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new StatusResponse(f, quotas.quota(auth.getName())));
    }
}
