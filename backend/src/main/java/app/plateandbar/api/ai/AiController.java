package app.plateandbar.api.ai;

import app.plateandbar.api.common.FiniteNumbers;
import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code /api/v1/ai/*}. The user is always the token's principal. Bodies are never logged. */
@RestController
@RequestMapping("/api/v1/ai")
public class AiController {

    public record Features(
            @JsonProperty("describe_meal") boolean describeMeal,
            @JsonProperty("ask_why") boolean askWhy,
            @JsonProperty("weekly_summary") boolean weeklySummary,
            @JsonProperty("suggest_tags") boolean suggestTags,
            @JsonProperty("meal_photo") boolean mealPhoto,
            @JsonProperty("import_recipe") boolean importRecipe,
            @JsonProperty("form_check") boolean formCheck) {}

    public record StatusResponse(@JsonProperty("features") Features features, @JsonProperty("quota") AiQuota quota) {}

    private final AiQuotaService quotas;
    private final RateLimiter limiter;
    private final ClientIpResolver ips;
    private final RateLimitProperties limits;

    /** The most of a body this controller reads: 16 KB (16,384 bytes). Bigger is 400 too_large, never buffered. */
    static final int MAX_BODY_BYTES = 16 * 1024;
    /** The image calls take up to 2 MB (four 350,000-byte frames in base64); a body over it is 400 too_large. */
    static final int MAX_IMAGE_BODY_BYTES = 2 * 1024 * 1024;

    AiController(AiQuotaService quotas, AiService ai, ObjectMapper json, RateLimiter limiter, ClientIpResolver ips,
            RateLimitProperties limits) {
        this.ai = ai;
        this.json = json.rebuild()
                .enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .enable(tools.jackson.core.StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                .build();
        this.quotas = quotas;
        this.limiter = limiter;
        this.ips = ips;
        this.limits = limits;
    }

    private final AiService ai;
    private final ObjectMapper json;

    /** Order: token (filter), per-IP and per-user limits, then the service (switch, validation, quota, provider). */
    private ResponseEntity<ObjectNode> post(
            Authentication auth, HttpServletRequest request, int maxBody, AiCall call) throws IOException {
        limiter.consume("ai-ip", ips.resolve(request), limits.getAiPerIp());
        limiter.consume("ai-user", auth.getName(), limits.getAiPerUser());
        // At most the limit + 1 byte is read, so a huge body is never held in memory; the rest is not read at all.
        byte[] raw = request.getInputStream().readNBytes(maxBody + 1);
        JsonNode body = AiSchemas.TOO_LARGE; // 400 too_large after the feature switch, in the validation step
        if (raw.length <= maxBody) {
            try {
                body = json.readTree(raw);
                if (!FiniteNumbers.all(body)) {
                    body = null; // a number too large for a double (#420): answered as unparseable
                }
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
    public ResponseEntity<ObjectNode> describeMeal(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_BODY_BYTES, ai::describeMeal);
    }

    @PostMapping(path = "/ask-why", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> askWhy(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_BODY_BYTES, ai::askWhy);
    }

    @PostMapping(path = "/weekly-summary", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> weeklySummary(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_BODY_BYTES, ai::weeklySummary);
    }

    @PostMapping(path = "/suggest-tags", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> suggestTags(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_BODY_BYTES, ai::suggestTags);
    }

    @PostMapping(path = "/meal-photo", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> mealPhoto(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_IMAGE_BODY_BYTES, ai::mealPhoto);
    }

    @PostMapping(path = "/import-recipe", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> importRecipe(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_IMAGE_BODY_BYTES, ai::importRecipe);
    }

    @PostMapping(path = "/form-check", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ObjectNode> formCheck(Authentication a, HttpServletRequest r) throws IOException {
        return post(a, r, MAX_IMAGE_BODY_BYTES, ai::formCheck);
    }

    /** Only the per-IP limit applies here; it is not part of the 5-per-minute AI limit. */
    @GetMapping(path = "/status", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StatusResponse> status(Authentication auth, HttpServletRequest request) {
        limiter.consume("ai-ip", ips.resolve(request), limits.getAiPerIp());
        var on = quotas.features();
        Features f = new Features(
                on(on, AiFeature.DESCRIBE_MEAL), on(on, AiFeature.ASK_WHY), on(on, AiFeature.WEEKLY_SUMMARY),
                on(on, AiFeature.SUGGEST_TAGS), on(on, AiFeature.MEAL_PHOTO), on(on, AiFeature.IMPORT_RECIPE),
                on(on, AiFeature.FORM_CHECK));
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new StatusResponse(f, quotas.quota(auth.getName())));
    }

    private static boolean on(java.util.Map<AiFeature, Boolean> features, AiFeature f) {
        return Boolean.TRUE.equals(features.get(f));
    }
}
