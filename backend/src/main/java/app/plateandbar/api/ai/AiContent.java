package app.plateandbar.api.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * {@code content/cards.json} and {@code content/exercises.json}, bundled into the jar by Gradle (see README):
 * the cards Ask why is grounded on and the exercise catalogue Weekly summary checks names against.
 */
@Component
public class AiContent {

    public record Card(String id, String title, String summary, String body, String evidence, String source) {}

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

    public AiContent(ObjectMapper json) {
        JsonNode c = read(json, "/content/cards.json");
        for (JsonNode n : c.path("cards")) {
            cards.put(n.path("id").asText(), new Card(
                    n.path("id").asText(),
                    render(n.path("title").asText()),
                    render(n.path("summary").asText()),
                    render(n.path("body").asText()),
                    n.path("evidence").asText(),
                    n.path("source").asText()));
        }
        List<String> ids = new ArrayList<>();
        read(json, "/content/exercises.json").path("tags").fieldNames().forEachRemaining(ids::add);
        this.exerciseIds = Set.copyOf(ids);
        if (cards.isEmpty() || exerciseIds.isEmpty()) {
            throw new IllegalStateException("content/cards.json or content/exercises.json is empty");
        }
    }

    private static JsonNode read(ObjectMapper json, String resource) {
        try (InputStream in = AiContent.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException(resource + " is not on the classpath (see backend/README.md)");
            }
            return json.readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException(resource + " cannot be read", e);
        }
    }

    public boolean hasCard(String id) {
        return cards.containsKey(id);
    }

    public Iterable<Card> cards() {
        return cards.values();
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
