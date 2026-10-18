package app.plateandbar.api.ai;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * {@code content/cards.json}, {@code exercises.json}, {@code foods.json} and {@code raw-ingredients.json}, bundled into
 * the jar by Gradle (see README): the cards Ask why is grounded on, the exercise catalogue Weekly summary checks names
 * against, the exercise cards Form check judges, the built-in foods Meal photo matches and the raw table Import recipe
 * matches. Content only, never a user's own foods. A card with {@code hidden: true} is skipped, so it is not shown to
 * the model and {@link #hasCard} is false for it.
 */
@Component
public class AiContent {

    public record Card(String id, String title, String summary, String body, String evidence, String source) {}

    /** A built-in food: its name, serving in words and macros per serving ({@code content/foods.json}). */
    public record Food(String name, String serving, double kcal, double proteinG, double carbsG, double fatG) {}

    /** An exercise card's {@code key_cues} and {@code common_mistakes}, verbatim. */
    public record ExerciseCard(List<String> keyCues, List<String> commonMistakes) {}

    private static final Pattern BLOCK =
            Pattern.compile("\\{\\?(\\w+)\\}(.*?)(?:\\{:\\}(.*?))?\\{/\\1\\}", Pattern.DOTALL);
    private static final Pattern BARE = Pattern.compile("\\{(\\w+)\\}");
    private static final Map<String, String> PHRASES = Map.ofEntries(
            Map.entry("kcal", "your calorie target"),
            Map.entry("protein_g", "your protein target"),
            Map.entry("protein_floor", "your minimum protein"),
            Map.entry("tdee", "your estimated daily burn"),
            Map.entry("bmr", "your resting burn"),
            Map.entry("movement", "your daily movement"),
            Map.entry("training", "your training"),
            Map.entry("digestion", "digestion"),
            Map.entry("weight", "your weight"),
            Map.entry("minutes", "your session length"),
            Map.entry("days", "your training days"),
            Map.entry("split_name", "your training split"));

    private final Map<String, Card> cards = new LinkedHashMap<>();
    private final Set<String> exerciseIds;
    private final Map<String, ExerciseCard> exerciseCards = new LinkedHashMap<>();
    private final Map<String, Food> foods = new LinkedHashMap<>();
    /** Lower-case name to the table's name, so a model's capitalisation still matches. */
    private final Map<String, String> rawIngredients = new LinkedHashMap<>();

    public AiContent(ObjectMapper json) {
        JsonNode c = read(json, "/content/cards.json");
        for (JsonNode n : c.path("cards")) {
            if (n.path("hidden").asBoolean(false)) {
                continue; // held back (weak source, #212): not in the prompt, and neither a request nor a reply may name it
            }
            cards.put(n.path("id").asString(), new Card(
                    n.path("id").asString(),
                    render(n.path("title").asString()),
                    render(n.path("summary").asString()),
                    render(n.path("body").asString()),
                    n.path("evidence").asString(),
                    n.path("source").asString()));
        }
        List<String> ids = new ArrayList<>();
        JsonNode exercises = read(json, "/content/exercises.json");
        exercises.path("tags").propertyNames().forEach(ids::add);
        this.exerciseIds = Set.copyOf(ids);
        exercises.path("cards").properties().forEach(e -> exerciseCards.put(e.getKey(),
                new ExerciseCard(strings(e.getValue().path("key_cues")), strings(e.getValue().path("common_mistakes")))));
        for (JsonNode f : read(json, "/content/foods.json").path("foods")) {
            JsonNode per = f.path("per_serving");
            foods.put(f.path("name").asString(), new Food(f.path("name").asString(),
                    f.path("serving").path("label").asString(), per.path("kcal").asDouble(),
                    per.path("protein_g").asDouble(), per.path("carbs_g").asDouble(), per.path("fat_g").asDouble()));
        }
        for (JsonNode i : read(json, "/content/raw-ingredients.json").path("ingredients")) {
            rawIngredients.putIfAbsent(i.path("name").asString().toLowerCase(java.util.Locale.ROOT), i.path("name").asString());
        }
        if (cards.isEmpty() || exerciseIds.isEmpty() || exerciseCards.isEmpty() || foods.isEmpty() || rawIngredients.isEmpty()) {
            throw new IllegalStateException("a content file the AI proxy needs is empty (see backend/README.md)");
        }
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(v -> out.add(v.asString()));
        return List.copyOf(out);
    }

    private static JsonNode read(ObjectMapper json, String resource) {
        try (InputStream in = AiContent.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException(resource + " is not on the classpath (see backend/README.md)");
            }
            return json.readTree(in);
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException(resource + " cannot be read", e);
        }
    }

    public boolean hasCard(String id) {
        return cards.containsKey(id);
    }

    public Iterable<Card> cards() {
        return cards.values();
    }

    /** The card of a catalogue exercise ({@code cards} key in exercises.json); empty for any other name. */
    public java.util.Optional<ExerciseCard> exerciseCard(String name) {
        return java.util.Optional.ofNullable(exerciseCards.get(name));
    }

    public Iterable<Food> foods() {
        return foods.values();
    }

    /** True when {@code name} is exactly the name of a built-in food. */
    public boolean hasFood(String name) {
        return foods.containsKey(name);
    }

    public Iterable<String> rawIngredientNames() {
        return rawIngredients.values();
    }

    /** The raw table's own spelling of {@code name} (any capitalisation), or empty when it is not in the table. */
    public java.util.Optional<String> rawIngredient(String name) {
        return java.util.Optional.ofNullable(rawIngredients.get(name.strip().toLowerCase(java.util.Locale.ROOT)));
    }

    public boolean isCatalogueExercise(String name) {
        return exerciseIds.contains(name);
    }

    /**
     * Drops conditional blocks {@code {?x}...{/x}} (or keeps their else branch {@code {:}}), turns each bare
     * {@code {x}} into a neutral phrase, and removes any brace left over, so the model never sees a placeholder.
     */
    static String render(String text) {
        Matcher m = BLOCK.matcher(text);
        String out = m.replaceAll(r -> Matcher.quoteReplacement(r.group(3) == null ? "" : r.group(3)));
        out = BARE.matcher(out).replaceAll(r -> Matcher.quoteReplacement(PHRASES.getOrDefault(r.group(1), "this figure")));
        return out.replace("{", "").replace("}", "");
    }
}
