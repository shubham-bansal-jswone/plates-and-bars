package app.plateandbar.api.ai;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * The three AI calls, in the contract's order after rate limits: switch, validation, quota, provider. Logs only
 * user id, feature, status and duration, never a body. The identical-request cache is per user, in memory only,
 * keyed by user id and a hash of the normalised request, and expires within 24 hours.
 */
@Service
public class AiService {

    public static final String CUSTOM_EXERCISE = "custom exercise";
    private static final Logger log = LoggerFactory.getLogger(AiService.class);

    private final AiQuotaService quotas;
    private final AiProvider provider;
    private final AiSchemas schemas;
    private final AiContent content;
    private final AiReplies replies;
    private final ObjectMapper json;
    private final Cache<String, ObjectNode> cache =
            Caffeine.newBuilder().maximumSize(10_000).expireAfterWrite(Duration.ofHours(12)).build();

    AiService(AiQuotaService quotas, AiProvider provider, AiSchemas schemas, AiContent content, AiReplies replies,
            ObjectMapper json) {
        this.quotas = quotas;
        this.provider = provider;
        this.schemas = schemas;
        this.content = content;
        this.replies = replies;
        this.json = json;
    }

    public ObjectNode describeMeal(String userId, JsonNode body) {
        return run(userId, AiFeature.DESCRIBE_MEAL, body, "DescribeMealRequest", req -> {
            String text = req.path("text").asText().trim();
            return new Call(AiPrompts.describeMeal(text), json.createObjectNode().put("text", text), replies::describeMeal);
        });
    }

    public ObjectNode askWhy(String userId, JsonNode body) {
        return run(userId, AiFeature.ASK_WHY, body, "AskWhyRequest", req -> {
            String cardId = req.path("card_id").asText();
            if (!content.hasCard(cardId)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("card_id", "unknown")));
            }
            String question = req.path("question").asText().trim();
            return new Call(AiPrompts.askWhy(content.cards(), cardId, question),
                    json.createObjectNode().put("card_id", cardId).put("question", question), replies::askWhy);
        });
    }

    public ObjectNode weeklySummary(String userId, JsonNode body) {
        return run(userId, AiFeature.WEEKLY_SUMMARY, body, "WeeklySummaryRequest", req -> {
            ObjectNode facts = req.deepCopy();
            ArrayNode improved = facts.withArray("improved");
            for (JsonNode i : improved) {
                ((ObjectNode) i).put("exercise", coerce(i.path("exercise").asText()));
            }
            ArrayNode stalled = json.createArrayNode();
            for (JsonNode s : facts.path("stalled")) {
                stalled.add(coerce(s.asText()));
            }
            facts.set("stalled", stalled);
            return new Call(AiPrompts.weeklySummary(facts), facts, replies::weeklySummary);
        });
    }

    private String coerce(String exercise) {
        return content.isCatalogueExercise(exercise) ? exercise : CUSTOM_EXERCISE;
    }

    private record Call(AiPrompts.Prompt prompt, ObjectNode cacheKeyMaterial, Function<String, Optional<ObjectNode>> parser) {}

    private ObjectNode run(String userId, AiFeature feature, JsonNode body, String requestSchema,
            Function<JsonNode, Call> plan) {
        long start = System.nanoTime();
        String status = "error";
        try {
            quotas.requireOn(feature);
            schemas.requireValid(requestSchema, body);
            Call call = plan.apply(body);
            AiQuotaService.Reservation held = quotas.reserve(userId, feature);
            ObjectNode reply;
            try {
                reply = answer(userId, feature, call, held);
            } catch (RuntimeException e) {
                quotas.release(held);
                throw e;
            }
            ObjectNode out = reply.deepCopy();
            out.set("quota", json.valueToTree(held.quota()));
            status = "200";
            return out;
        } catch (ApiException e) {
            status = Integer.toString(e.status().value());
            throw e;
        } finally {
            log.info("AI call: user {} feature {} status {} took {} ms", userId, feature.key(), status,
                    Duration.ofNanos(System.nanoTime() - start).toMillis());
        }
    }

    private ObjectNode answer(String userId, AiFeature feature, Call call, AiQuotaService.Reservation held) {
        String key = userId + ":" + feature.key() + ":" + sha256(call.cacheKeyMaterial().toString());
        ObjectNode hit = cache.getIfPresent(key);
        if (hit != null) {
            return hit; // still counts against the quota
        }
        AiProvider.Completion c;
        try {
            c = provider.complete(feature, call.prompt().instructions(), call.prompt().input());
        } catch (RuntimeException e) {
            log.warn("AI provider failed for feature {} ({})", feature.key(), e.getClass().getSimpleName());
            throw unavailable();
        }
        if (c == null || c.text() == null) {
            throw unavailable();
        }
        quotas.recordTokens(held, c.inputTokens(), c.outputTokens());
        ObjectNode reply = call.parser().apply(c.text()).orElseThrow(AiService::unavailable);
        cache.put(key, reply);
        return reply;
    }

    static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "unavailable", "Couldn't get an answer just now. Try again.");
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
