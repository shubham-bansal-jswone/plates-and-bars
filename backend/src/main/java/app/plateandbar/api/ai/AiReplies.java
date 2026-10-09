package app.plateandbar.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Parses a model reply as data and checks it against the contract's response schemas. Any failure returns empty,
 * which the caller turns into 503 {@code unavailable}. The reply is never executed, followed or logged.
 */
@Component
class AiReplies {

    private static final List<String> NUMBERS = List.of("kcal", "protein_g", "carbs_g", "fat_g");
    private static final List<Double> MAX = List.of(5000d, 1000d, 1000d, 1000d);

    private final ObjectMapper json;
    private final AiSchemas schemas;
    private final AiContent content;

    AiReplies(ObjectMapper json, AiSchemas schemas, AiContent content) {
        this.json = json;
        this.schemas = schemas;
        this.content = content;
    }

    /** The reply fields without {@code quota}. */
    Optional<ObjectNode> describeMeal(String raw) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty() || !root.get().path("items").isArray()) {
            return Optional.empty();
        }
        ArrayNode kept = json.createArrayNode();
        for (JsonNode item : root.get().path("items")) {
            if (!item.isObject()) {
                return Optional.empty();
            }
            if (numbersInRange(item)) {
                kept.add(item);
            }
        }
        ObjectNode out = json.createObjectNode();
        out.set("items", kept);
        return valid("DescribeMealResponse", out);
    }

    Optional<ObjectNode> askWhy(String raw) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty()) {
            return Optional.empty();
        }
        JsonNode id = root.get().path("card_id");
        if (!id.isNull() && !id.isMissingNode() && !id.isTextual()) {
            return Optional.empty();
        }
        ObjectNode out = json.createObjectNode();
        out.set("answer", root.get().path("answer"));
        if (id.isTextual() && content.hasCard(id.asText())) {
            out.set("card_id", id);
        } else {
            out.putNull("card_id");
        }
        String answer = out.path("answer").asText("");
        if (answer.contains("{") || answer.contains("}")) {
            return Optional.empty();
        }
        return valid("AskWhyResponse", out);
    }

    Optional<ObjectNode> weeklySummary(String raw) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty()) {
            return Optional.empty();
        }
        ObjectNode out = json.createObjectNode();
        out.set("text", root.get().path("text"));
        return valid("WeeklySummaryResponse", out);
    }

    private boolean numbersInRange(JsonNode item) {
        for (int i = 0; i < NUMBERS.size(); i++) {
            JsonNode n = item.path(NUMBERS.get(i));
            if (!n.isNumber() || !Double.isFinite(n.asDouble()) || n.asDouble() < 0 || n.asDouble() > MAX.get(i)) {
                return false;
            }
        }
        return true;
    }

    private Optional<ObjectNode> parse(String raw) {
        try {
            JsonNode n = json.readTree(raw);
            return n != null && n.isObject() ? Optional.of((ObjectNode) n) : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /** Schema check of the reply plus a placeholder quota (the real one is added by the caller). */
    private Optional<ObjectNode> valid(String schemaName, ObjectNode reply) {
        ObjectNode probe = reply.deepCopy();
        ObjectNode q = probe.putObject("quota");
        q.put("limit", 0).put("remaining", 0).put("resets_at", "2000-01-01T00:00:00Z");
        return schemas.problems(schemaName, probe).isEmpty() ? Optional.of(reply) : Optional.empty();
    }
}
