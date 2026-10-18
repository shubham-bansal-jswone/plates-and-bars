package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** The output checks of the three image calls (ADR 008, contract Images): repair what can be repaired, else 503. */
class AiRepliesImageTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final AiContent CONTENT = new AiContent(JSON);
    private static final AiReplies REPLIES = new AiReplies(JSON, new AiSchemas(), CONTENT);

    private static String item(String extra) {
        return "{\"name\":\"Roti\",\"qty\":\"2\",\"kcal\":240,\"protein_g\":7,\"carbs_g\":46,\"fat_g\":3" + extra + "}";
    }

    private static ObjectNode meal(String reply) {
        return REPLIES.mealPhoto(reply).orElseThrow();
    }

    @Test
    void mealPhotoKeepsTwelveItemsAtMostAndDropsBadOnes() {
        StringBuilder items = new StringBuilder();
        for (int i = 0; i < 15; i++) {
            items.append(i == 0 ? "" : ",").append(item(""));
        }
        assertThat(meal("{\"items\":[" + items + "]}").path("items")).hasSize(12);
        String bad = "{\"items\":[" + item(",\"kcal\":-1").replace("\"kcal\":240,", "") + ","
                + "{\"name\":\"  \",\"qty\":\"\",\"kcal\":1,\"protein_g\":1,\"carbs_g\":1,\"fat_g\":1},"
                + "{\"name\":\"Big\",\"qty\":\"\",\"kcal\":5001,\"protein_g\":1,\"carbs_g\":1,\"fat_g\":1},"
                + "{\"name\":\"NaN\",\"qty\":\"\",\"kcal\":\"x\",\"protein_g\":1,\"carbs_g\":1,\"fat_g\":1}," + item("") + "]}";
        assertThat(meal(bad).path("items")).hasSize(1);
    }

    @Test
    void mealPhotoReadsAnUnknownConfidenceAsMediumAndClampsServingsOnlyForABuiltInMatch() {
        JsonNode out = meal("{\"items\":[" + item(",\"confidence\":\"certain\",\"match\":\"Roti / chapati\",\"servings\":50") + ","
                + item(",\"confidence\":\"low\",\"match\":\"Roti / chapati\",\"servings\":0.01") + ","
                + item(",\"confidence\":\"high\",\"match\":\"roti / chapati\",\"servings\":3") + ","
                + item(",\"match\":null,\"servings\":4") + "]}");
        assertThat(out.path("items").get(0).path("confidence").asString()).isEqualTo("medium");
        assertThat(out.path("items").get(0).path("servings").asDouble()).isEqualTo(6);
        assertThat(out.path("items").get(1).path("servings").asDouble()).isEqualTo(0.25);
        assertThat(out.path("items").get(1).path("confidence").asString()).isEqualTo("low");
        assertThat(out.path("items").get(2).path("match").isNull()).as("the match is exact, case included").isTrue();
        assertThat(out.path("items").get(2).path("servings").asDouble()).isEqualTo(1);
        assertThat(out.path("items").get(3).path("servings").asDouble()).isEqualTo(1); // no match: 1
    }

    @Test
    void mealPhotoCutsLongTextAndSaysNotFoodWhenNothingIsLeft() {
        JsonNode cut = meal("{\"items\":[" + item("").replace("\"Roti\"", "\"" + "n".repeat(150) + "\"").replace("\"2\"", "\"" + "q".repeat(80) + "\"") + "]}");
        assertThat(cut.path("items").get(0).path("name").asString()).hasSize(100);
        assertThat(cut.path("items").get(0).path("qty").asString()).hasSize(50);
        assertThat(meal("{\"items\":[]}").path("not_food").asBoolean()).isTrue();
        JsonNode said = meal("{\"not_food\":true,\"items\":[" + item("") + "]}");
        assertThat(said.path("not_food").asBoolean()).isTrue();
        assertThat(said.path("items")).isEmpty();
        for (String junk : new String[] {"", "nope", "[]", "{\"items\":{}}", "{}"}) {
            assertThat(REPLIES.mealPhoto(junk)).as(junk).isEmpty();
        }
    }

    private static ObjectNode recipe(String reply) {
        return REPLIES.importRecipe(reply).orElseThrow();
    }

    @Test
    void importRecipeMatchesTheRawTableAndMovesTheRestToUnmatchedAsWritten() {
        JsonNode out = recipe("{\"name\":\" Dal tadka \",\"katoris\":6,\"ingredients\":["
                + "{\"ingredient\":\"TOOR DAL (DRY)\",\"as_written\":\"1 cup toor dal\",\"grams\":200},"
                + "{\"ingredient\":\"Besan\",\"as_written\":\"besan\",\"grams\":0},"
                + "{\"ingredient\":\"Besan\",\"as_written\":\"besan 2\",\"grams\":10001},"
                + "{\"ingredient\":\"Besan\",\"as_written\":\"besan 3\",\"grams\":\"lots\"},"
                + "{\"ingredient\":\"Besan\",\"grams\":1e999},"
                + "{\"ingredient\":\"Moonrock\",\"as_written\":\"1 moonrock\",\"grams\":5},"
                + "{\"ingredient\":\"Oats\",\"as_written\":\"oats\",\"grams\":10000}],"
                + "\"steps\":[\"One.\",\"\",5,\"Two.\"],\"unmatched\":[\"salt\",\"salt\",\"1 moonrock\",7]}");
        assertThat(out.path("name").asString()).isEqualTo("Dal tadka");
        assertThat(out.path("katoris").asDouble()).isEqualTo(6);
        assertThat(out.path("ingredients")).hasSize(2);
        assertThat(out.path("ingredients").get(0).path("ingredient").asString()).isEqualTo("Toor dal (dry)");
        assertThat(out.path("ingredients").get(1).path("amount").asDouble()).isEqualTo(10000);
        assertThat(out.path("unmatched")).extracting(JsonNode::asString)
                .containsExactly("besan", "besan 2", "besan 3", "Besan", "1 moonrock", "salt");
        assertThat(out.path("steps")).extracting(JsonNode::asString).containsExactly("One.", "Two.");
    }

    @Test
    void importRecipeFallsBackToTheContractsDefaultsAndBoundsEveryList() {
        JsonNode out = recipe("{}");
        assertThat(out.path("name").asString()).isEqualTo("Imported recipe");
        assertThat(out.path("katoris").asDouble()).isEqualTo(4);
        assertThat(out.path("ingredients")).isEmpty();
        for (String katoris : new String[] {"0", "-1", "1001", "\"six\""}) {
            assertThat(recipe("{\"katoris\":" + katoris + "}").path("katoris").asDouble()).as(katoris).isEqualTo(4);
        }
        StringBuilder many = new StringBuilder("{\"steps\":[");
        StringBuilder um = new StringBuilder("\"unmatched\":[");
        for (int i = 0; i < 130; i++) {
            many.append(i == 0 ? "" : ",").append("\"s").append(i).append("\"");
            um.append(i == 0 ? "" : ",").append("\"u").append(i).append("\"");
        }
        JsonNode capped = recipe(many + "]," + um + "]}");
        assertThat(capped.path("steps")).hasSize(20);
        assertThat(capped.path("unmatched")).hasSize(100);
        assertThat(recipe("{\"name\":\"" + "n".repeat(300) + "\"}").path("name").asString()).hasSize(200);
        assertThat(REPLIES.importRecipe("not json")).isEmpty();
    }

    private static final AiContent.ExerciseCard CARD = CONTENT.exerciseCard("Goblet Squat").orElseThrow();

    private static Optional<ObjectNode> form(String reply) {
        return REPLIES.formCheck(reply, CARD);
    }

    @Test
    void formCheckKeepsOnlyTheCardsCuesVerbatimOnceEachAndReadsAnUnknownStatusAsUnclear() {
        String c0 = CARD.keyCues().get(0);
        String c1 = CARD.keyCues().get(1);
        JsonNode out = form("{\"visible\":true,\"checks\":[{\"cue\":\"" + c0 + "\",\"status\":\"good\",\"note\":\"Nice.\"},"
                + "{\"cue\":\"" + c0 + "\",\"status\":\"watch\",\"note\":\"dup\"},"
                + "{\"cue\":\"" + c1.toLowerCase() + "\",\"status\":\"good\",\"note\":\"case differs\"},"
                + "{\"cue\":\"" + c1 + "\",\"status\":\"???\",\"note\":5},"
                + "{\"cue\":\"" + c1 + " \",\"status\":\"good\",\"note\":\"trailing space\"}],\"summary\":\"Fine.\"}").orElseThrow();
        assertThat(out.path("checks")).hasSize(2);
        assertThat(out.path("checks").get(0).path("note").asString()).isEqualTo("Nice.");
        assertThat(out.path("checks").get(1).path("cue").asString()).isEqualTo(c1);
        assertThat(out.path("checks").get(1).path("status").asString()).isEqualTo("unclear");
        assertThat(out.path("checks").get(1).path("note").asString()).isEmpty(); // a number is not a note
        assertThat(out.path("summary").asString()).isEqualTo("Fine.");
    }

    @Test
    void formCheckWithTheBodyNotVisibleHasNoChecksAndAnUnparseableOrUntypedReplyIsEmpty() {
        JsonNode out = form("{\"visible\":false,\"checks\":[{\"cue\":\"" + CARD.keyCues().get(0)
                + "\",\"status\":\"good\",\"note\":\"x\"}],\"summary\":\"" + "s".repeat(700) + "\"}").orElseThrow();
        assertThat(out.path("visible").asBoolean()).isFalse();
        assertThat(out.path("checks")).isEmpty();
        assertThat(out.path("summary").asString()).hasSize(600);
        for (String junk : new String[] {"", "x", "{}", "{\"visible\":\"yes\"}", "{\"visible\":1}", "[]"}) {
            assertThat(form(junk)).as(junk).isEmpty();
        }
    }
}
