package app.plateandbar.api.ai;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
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
 * The seven AI calls, in the contract's order after rate limits: switch, validation (image faults included), quota,
 * provider. Logs only user id, feature, status and duration, never a body. The identical-request cache of the four text
 * calls is per user, in memory only, keyed by user id and a hash of the normalised request, and expires within 24
 * hours; the three image calls are never cached (ADR 008).
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
            String text = AiPrompts.sanitize(req.path("text").asString()).trim();
            if (AiPrompts.isBlank(text)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("text", "pattern")));
            }
            return new Call(AiPrompts.describeMeal(text), json.createObjectNode().put("text", text), replies::describeMeal);
        });
    }

    public ObjectNode askWhy(String userId, JsonNode body) {
        return run(userId, AiFeature.ASK_WHY, body, "AskWhyRequest", req -> {
            String cardId = req.path("card_id").asString();
            if (!content.hasCard(cardId)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("card_id", "unknown")));
            }
            String question = AiPrompts.sanitize(req.path("question").asString()).trim();
            if (AiPrompts.isBlank(question)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("question", "pattern")));
            }
            return new Call(AiPrompts.askWhy(content.cards(), cardId, question),
                    json.createObjectNode().put("card_id", cardId).put("question", question), replies::askWhy);
        });
    }

    public ObjectNode weeklySummary(String userId, JsonNode body) {
        return run(userId, AiFeature.WEEKLY_SUMMARY, body, "WeeklySummaryRequest", req -> {
            ObjectNode facts = (ObjectNode) req.deepCopy();
            ArrayNode improved = facts.withArrayProperty("improved");
            for (JsonNode i : improved) {
                ((ObjectNode) i).put("exercise", coerce(i.path("exercise").asString()));
            }
            ArrayNode stalled = json.createArrayNode();
            for (JsonNode s : facts.path("stalled")) {
                stalled.add(coerce(s.asString()));
            }
            facts.set("stalled", stalled);
            return new Call(AiPrompts.weeklySummary(facts), facts, replies::weeklySummary);
        });
    }

    public ObjectNode suggestTags(String userId, JsonNode body) {
        return run(userId, AiFeature.SUGGEST_TAGS, body, "SuggestTagsRequest", req -> {
            String name = AiPrompts.sanitize(req.path("name").asString()).trim();
            if (AiPrompts.isBlank(name)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("name", "pattern")));
            }
            return new Call(AiPrompts.suggestTags(name, schemas.muscles(), schemas.equipment()), json.createObjectNode().put("name", name), replies::suggestTags);
        });
    }

    public ObjectNode mealPhoto(String userId, JsonNode body) {
        return run(userId, AiFeature.MEAL_PHOTO, body, "MealPhotoRequest", req -> {
            String hint = req.has("hint") ? AiPrompts.sanitize(req.path("hint").asString()).trim() : null;
            if (hint != null && AiPrompts.isBlank(hint)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("hint", "pattern")));
            }
            List<byte[]> images = List.of(AiImages.reencode(req.get("image"), "image", AiImages.Kind.PHOTO));
            return new Call(AiPrompts.mealPhoto(content.foods(), hint), null, images, replies::mealPhoto);
        });
    }

    public ObjectNode importRecipe(String userId, JsonNode body) {
        return run(userId, AiFeature.IMPORT_RECIPE, body, "ImportRecipeRequest", req -> {
            String text = req.has("text") ? AiPrompts.sanitize(req.path("text").asString()).trim() : null;
            if (text != null && AiPrompts.isBlank(text)) {
                throw AiSchemas.invalid(List.of(new ErrorResponse.Detail("text", "pattern")));
            }
            List<byte[]> images = req.has("image")
                    ? List.of(AiImages.reencode(req.get("image"), "image", AiImages.Kind.PHOTO)) : List.of();
            return new Call(AiPrompts.importRecipe(text, content.rawIngredientNames()), null, images, replies::importRecipe);
        });
    }

    public ObjectNode formCheck(String userId, JsonNode body) {
        return run(userId, AiFeature.FORM_CHECK, body, "FormCheckRequest", req -> {
            String exercise = req.path("exercise").asString();
            AiContent.ExerciseCard card = content.exerciseCard(exercise).orElseThrow(
                    () -> AiSchemas.invalid(List.of(new ErrorResponse.Detail("exercise", "unknown"))));
            List<byte[]> frames = new java.util.ArrayList<>();
            for (int i = 0; i < req.path("frames").size(); i++) { // one decoded frame at a time; only the new JPEG is kept
                frames.add(AiImages.reencode(req.path("frames").get(i), "frames[" + i + "]", AiImages.Kind.FRAME));
            }
            return new Call(AiPrompts.formCheck(exercise, card), null, frames, raw -> replies.formCheck(raw, card));
        });
    }

    private String coerce(String exercise) {
        return content.isCatalogueExercise(exercise) ? exercise : CUSTOM_EXERCISE;
    }

    /** {@code images} are the re-encoded JPEGs of an image call, whose {@code cacheKeyMaterial} is null (never cached). */
    private record Call(AiPrompts.Prompt prompt, ObjectNode cacheKeyMaterial, List<byte[]> images,
            Function<String, Optional<ObjectNode>> parser) {
        Call(AiPrompts.Prompt prompt, ObjectNode cacheKeyMaterial, Function<String, Optional<ObjectNode>> parser) {
            this(prompt, cacheKeyMaterial, List.of(), parser);
        }
    }

    private ObjectNode run(String userId, AiFeature feature, JsonNode body, String requestSchema,
            Function<JsonNode, Call> plan) {
        long start = System.nanoTime();
        String status = "error";
        try {
            quotas.requireOn(feature);
            schemas.requireValid(requestSchema, switch (feature) {
                case MEAL_PHOTO, IMPORT_RECIPE -> AiImages.screenImage(body); // the base64 is scanned before any regex
                case FORM_CHECK -> AiImages.screenFrames(body);
                default -> body;
            });
            Call call = plan.apply(body);
            AiQuotaService.Reservation held = quotas.reserve(userId, feature);
            ObjectNode reply;
            try {
                reply = answer(userId, feature, call, held);
            } catch (BilledFailure e) {
                if (e.refundUnit) {
                    quotas.release(held); // unusable reply: the tokens stay in the monthly ledger, the daily unit goes back
                }
                throw e;
            } catch (RuntimeException e) {
                quotas.release(held);
                throw e;
            }
            ObjectNode out = reply.deepCopy();
            out.set("quota", json.valueToTree(held.quota()));
            status = "200";
            return out;
        } catch (ApiException e) {
            status = e instanceof ImageBusyException ? "503 busy" : Integer.toString(e.status().value()); // the decode cap turning people away
            throw e;
        } finally {
            log.info("AI call: user {} feature {} status {} took {} ms", userId, feature.key(), status,
                    Duration.ofNanos(System.nanoTime() - start).toMillis());
        }
    }

    private ObjectNode answer(String userId, AiFeature feature, Call call, AiQuotaService.Reservation held) {
        String key = feature.isImageCall() ? null
                : userId + ":" + feature.key() + ":" + sha256(call.cacheKeyMaterial().toString());
        ObjectNode hit = key == null ? null : cache.getIfPresent(key);
        if (hit != null) {
            return hit; // still counts against the quota
        }
        AiProvider.Completion c;
        try {
            c = feature.isImageCall()
                    ? provider.complete(feature, call.prompt().instructions(), call.prompt().input(), call.images())
                    : provider.complete(feature, call.prompt().instructions(), call.prompt().input());
        } catch (RuntimeException e) {
            log.warn("AI provider failed for feature {} ({})", feature.key(), e.getClass().getSimpleName());
            throw unavailable();
        }
        if (c == null) {
            throw unavailable(); // no response at all, nothing billed: the unit is released
        }
        // A response was received, so it was billed and the tokens go to the monthly ledger. If they cannot be
        // recorded the daily unit stays used; if the reply is unusable (no text, does not parse, a parser bug) the
        // answer is the same 503 `unavailable` but the daily unit is given back.
        try {
            quotas.recordTokens(held, c.inputTokens(), c.outputTokens());
        } catch (RuntimeException e) {
            log.warn("AI tokens not recorded for feature {} ({})", feature.key(), e.getClass().getSimpleName());
            throw new BilledFailure(false);
        }
        ObjectNode reply;
        try {
            if (c.text() == null) {
                throw new BilledFailure(true);
            }
            reply = call.parser().apply(c.text()).orElseThrow(() -> new BilledFailure(true));
        } catch (BilledFailure e) {
            throw e;
        } catch (RuntimeException e) {
            log.warn("AI reply unusable for feature {} ({})", feature.key(), e.getClass().getSimpleName());
            throw new BilledFailure(true);
        }
        if (key != null) {
            cache.put(key, reply);
        }
        return reply;
    }

    /** 503 {@code unavailable} after the provider's billed response could not be used; {@code refundUnit} gives the daily unit back. */
    private static final class BilledFailure extends ApiException {
        final boolean refundUnit;

        BilledFailure(boolean refundUnit) {
            super(HttpStatus.SERVICE_UNAVAILABLE, "unavailable", "Couldn't get an answer just now. Try again.");
            this.refundUnit = refundUnit;
        }
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
