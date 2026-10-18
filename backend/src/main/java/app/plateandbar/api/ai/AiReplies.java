package app.plateandbar.api.ai;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
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
    private static final List<String> ITEM_FIELDS = List.of("name", "qty", "kcal", "protein_g", "carbs_g", "fat_g");
    private static final List<Double> MAX = List.of(5000d, 1000d, 1000d, 1000d);

    private final ObjectMapper json;
    private final AiSchemas schemas;
    private final AiContent content;

    AiReplies(ObjectMapper json, AiSchemas schemas, AiContent content) {
        // A model often adds text after the JSON, so a reply is read up to the end of its first value, as before #720;
        // duplicate keys stay refused (the shared mapper's setting).
        this.json = json.rebuild().disable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
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
                ObjectNode clean = json.createObjectNode(); // only the contract's six fields
                for (String f : ITEM_FIELDS) {
                    clean.set(f, item.get(f));
                }
                kept.add(clean);
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
        if (!id.isNull() && !id.isMissingNode() && !id.isString()) {
            return Optional.empty();
        }
        ObjectNode out = json.createObjectNode();
        out.set("answer", root.get().path("answer"));
        if (id.isString() && content.hasCard(id.asString())) {
            out.set("card_id", id);
        } else {
            out.putNull("card_id");
        }
        String answer = out.path("answer").asString("");
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

    /**
     * Repairs instead of failing (the prototype's suggestTags()): unknown muscles dropped, the first 3 kept, equipment
     * falls back to machine, difficulty to 2, pattern and joints are cut to the schema limits. Empty only when the
     * reply does not parse.
     */
    Optional<ObjectNode> suggestTags(String raw) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty()) {
            return Optional.empty();
        }
        JsonNode r = root.get();
        ObjectNode out = json.createObjectNode();
        JsonNode pattern = r.path("pattern");
        out.put("pattern", pattern.isString() && pattern.asString().codePointCount(0, pattern.asString().length()) <= 50
                ? pattern.asString() : "");
        JsonNode eq = r.path("equipment");
        out.put("equipment", eq.isString() && schemas.equipment().contains(eq.asString()) ? eq.asString() : "machine");
        JsonNode d = r.path("difficulty");
        out.put("difficulty", d.isNumber() && d.asDouble() >= 1 && d.asDouble() <= 3 && d.asDouble() == Math.rint(d.asDouble())
                ? (int) d.asDouble() : 2);
        out.set("primary", muscles(r.path("primary")));
        out.set("secondary", muscles(r.path("secondary")));
        ArrayNode joints = out.putArray("joints");
        for (JsonNode j : r.path("joints")) {
            if (joints.size() < 20 && j.isString() && j.asString().codePointCount(0, j.asString().length()) <= 50) {
                joints.add(j.asString());
            }
        }
        return valid("SuggestTagsResponse", out);
    }

    /**
     * Meal photo. Repairs instead of failing: drops items with a bad name or non-finite or out-of-range numbers, keeps
     * 12 at most, reads an unknown confidence as medium, turns a {@code match} that is not a built-in food into null,
     * clamps {@code servings} to 0.25 to 6 (1 without a match) and cuts text to the schema limits. Empty only when the
     * reply does not parse.
     */
    Optional<ObjectNode> mealPhoto(String raw) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty() || !root.get().path("items").isArray()) {
            return Optional.empty();
        }
        ArrayNode kept = json.createArrayNode();
        for (JsonNode item : root.get().path("items")) {
            if (kept.size() == 12 || !item.isObject() || !numbersInRange(item) || !item.path("name").isString()
                    || item.path("name").asString().isBlank()) {
                continue;
            }
            ObjectNode clean = json.createObjectNode();
            clean.put("name", cut(item.path("name").asString(), 100));
            clean.put("qty", cut(str(item.path("qty")), 50));
            for (String n : NUMBERS) {
                clean.set(n, item.get(n));
            }
            String conf = str(item.path("confidence"));
            clean.put("confidence", List.of("high", "medium", "low").contains(conf) ? conf : "medium");
            JsonNode match = item.path("match");
            boolean matched = match.isString() && content.hasFood(match.asString());
            if (matched) {
                clean.put("match", match.asString());
            } else {
                clean.putNull("match");
            }
            JsonNode sv = item.path("servings");
            double servings = matched && sv.isNumber() && Double.isFinite(sv.asDouble())
                    ? Math.min(6, Math.max(0.25, sv.asDouble())) : 1;
            clean.put("servings", servings);
            kept.add(clean);
        }
        ObjectNode out = json.createObjectNode();
        out.put("not_food", kept.isEmpty() || root.get().path("not_food").asBoolean(false));
        out.set("items", out.path("not_food").asBoolean() ? json.createArrayNode() : kept);
        return valid("MealPhotoResponse", out);
    }

    /**
     * Import recipe. An ingredient that is not in the raw table or whose weight is unusable (not finite, 0 or less, over
     * 10,000 g) moves to {@code unmatched} as written. Defaults: name "Imported recipe", 4 katoris. Empty only when the
     * reply does not parse.
     */
    Optional<ObjectNode> importRecipe(String raw) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty()) {
            return Optional.empty();
        }
        JsonNode r = root.get();
        ObjectNode out = json.createObjectNode();
        out.put("name", r.path("name").isString() && !r.path("name").asString().isBlank()
                ? cut(r.path("name").asString().strip(), 200) : "Imported recipe");
        JsonNode k = r.path("katoris");
        out.put("katoris", k.isNumber() && Double.isFinite(k.asDouble()) && k.asDouble() > 0 && k.asDouble() <= 1000
                ? k.asDouble() : 4);
        ArrayNode ingredients = json.createArrayNode();
        List<String> unmatched = new java.util.ArrayList<>();
        for (JsonNode i : r.path("ingredients")) {
            String written = i.path("as_written").isString() && !i.path("as_written").asString().isBlank()
                    ? i.path("as_written").asString() : str(i.path("ingredient"));
            Optional<String> name = i.path("ingredient").isString() ? content.rawIngredient(i.path("ingredient").asString())
                    : Optional.empty();
            JsonNode g = i.path("grams");
            boolean usable = g.isNumber() && Double.isFinite(g.asDouble()) && g.asDouble() > 0 && g.asDouble() <= 10_000;
            if (name.isPresent() && usable && ingredients.size() < 100) {
                ingredients.addObject().put("ingredient", name.get()).put("amount", g.asDouble()).put("unit", "g");
            } else if (!written.isBlank()) {
                unmatched.add(written);
            }
        }
        for (JsonNode u : r.path("unmatched")) {
            if (u.isString() && !u.asString().isBlank()) {
                unmatched.add(u.asString());
            }
        }
        out.set("ingredients", ingredients);
        ArrayNode steps = out.putArray("steps");
        for (JsonNode s : r.path("steps")) {
            if (steps.size() < 20 && s.isString() && !s.asString().isBlank()) {
                steps.add(cut(s.asString(), 500));
            }
        }
        ArrayNode um = out.putArray("unmatched");
        unmatched.stream().map(u -> cut(u.strip(), 200)).distinct().limit(100).forEach(um::add);
        return valid("ImportRecipeResponse", out);
    }

    /**
     * Form check, for the exercise whose card is {@code card}. Drops checks whose cue is not one of the card's
     * {@code key_cues} verbatim (and repeats), reads an unknown status as unclear; {@code visible} must be a boolean.
     */
    Optional<ObjectNode> formCheck(String raw, AiContent.ExerciseCard card) {
        Optional<ObjectNode> root = parse(raw);
        if (root.isEmpty() || !root.get().path("visible").isBoolean()) {
            return Optional.empty();
        }
        JsonNode r = root.get();
        boolean visible = r.path("visible").asBoolean();
        ObjectNode out = json.createObjectNode();
        out.put("visible", visible);
        ArrayNode checks = out.putArray("checks");
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (JsonNode c : visible ? r.path("checks") : json.createArrayNode()) {
            String cue = str(c.path("cue"));
            if (checks.size() < 10 && card.keyCues().contains(cue) && seen.add(cue)) {
                String status = str(c.path("status"));
                ObjectNode o = checks.addObject();
                o.put("cue", cue);
                o.put("status", List.of("good", "watch", "unclear").contains(status) ? status : "unclear");
                o.put("note", cut(str(c.path("note")), 300));
            }
        }
        out.put("summary", cut(str(r.path("summary")), 600));
        return valid("FormCheckResponse", out);
    }

    /** The text of a string node; empty for anything else, so a number is not turned into text. */
    private static String str(JsonNode n) {
        return n.isString() ? n.asString() : "";
    }

    /** At most {@code max} characters (code points), so a longer text is shortened rather than failing the schema. */
    private static String cut(String s, int max) {
        return s.codePointCount(0, s.length()) <= max ? s : s.substring(0, s.offsetByCodePoints(0, max));
    }

    private ArrayNode muscles(JsonNode in) {
        ArrayNode out = json.createArrayNode();
        for (JsonNode m : in) {
            if (out.size() < 3 && m.isString() && schemas.muscles().contains(m.asString())) {
                out.add(m.asString());
            }
        }
        return out;
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
