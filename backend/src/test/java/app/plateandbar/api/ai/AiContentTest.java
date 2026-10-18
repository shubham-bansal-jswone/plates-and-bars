package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class AiContentTest {

    @Test
    void conditionalBlocksAreDroppedOrReplacedByTheirElseBranchAndPlaceholdersNeutralised() {
        assertThat(AiContent.render("A {?tdee}burn {tdee}. {/tdee}Target {kcal}.")).isEqualTo("A Target your calorie target.");
        assertThat(AiContent.render("X{?weight}with {weight}{:}without{/weight}Y")).isEqualTo("XwithoutY");
        assertThat(AiContent.render("{unknown_thing} {")).isEqualTo("this figure ");
        assertThat(AiContent.render("$1 and \\ {kcal}")).isEqualTo("$1 and \\ your calorie target");
    }

    @Test
    void theBundledCardsAndCatalogueLoadAndNoCardCarriesABrace() {
        AiContent c = new AiContent(new ObjectMapper());
        int n = 0;
        for (AiContent.Card card : c.cards()) {
            n++;
            assertThat(card.body() + card.title() + card.summary()).as(card.id()).doesNotContain("{", "}");
            assertThat(c.hasCard(card.id())).isTrue();
        }
        assertThat(n).isGreaterThanOrEqualTo(20);
        assertThat(c.hasCard("protein")).isTrue();
        assertThat(c.hasCard("nope")).isFalse();
        assertThat(c.isCatalogueExercise("Goblet Squat")).isTrue();
        assertThat(c.isCatalogueExercise("My Secret Lift")).isFalse();
    }

    @Test
    void aCardFlaggedHiddenIsAbsentFromThePromptAndNeitherARequestNorAReplyMayNameIt() throws Exception {
        ObjectMapper json = new ObjectMapper();
        java.util.List<String> hidden = new java.util.ArrayList<>();
        try (java.io.InputStream in = AiContent.class.getResourceAsStream("/content/cards.json")) {
            for (tools.jackson.databind.JsonNode n : json.readTree(in).path("cards")) {
                if (n.path("hidden").asBoolean(false)) {
                    hidden.add(n.path("id").asString());
                }
            }
        }
        assertThat(hidden).as("the bundled cards.json holds back at least one card").isNotEmpty();
        AiContent c = new AiContent(json);
        String input = AiPrompts.askWhy(c.cards(), "protein", "why?").input();
        for (String id : hidden) {
            assertThat(c.hasCard(id)).as(id).isFalse();
            assertThat(input).as(id).doesNotContain("[card " + id + "]");
            ObjectNode reply = new AiReplies(json, new AiSchemas(), c)
                    .askWhy("{\"answer\":\"Because.\",\"card_id\":\"" + id + "\"}").orElseThrow();
            assertThat(reply.path("card_id").isNull()).as(id).isTrue();
        }
        assertThat(input).contains("[card protein]");
        assertThat(c.hasCard("protein")).isTrue();
    }

    @Test
    void theBuiltInFoodsTheRawTableAndTheExerciseCardsLoadFromTheBundledContent() {
        AiContent c = new AiContent(new ObjectMapper());
        assertThat(c.hasFood("Roti / chapati")).isTrue();
        assertThat(c.hasFood("roti / chapati")).as("a food match is exact").isFalse();
        AiContent.Food roti = java.util.stream.StreamSupport.stream(c.foods().spliterator(), false)
                .filter(f -> f.name().equals("Roti / chapati")).findFirst().orElseThrow();
        assertThat(roti.serving()).isEqualTo("1 medium (30 g atta)");
        assertThat(roti.kcal()).isEqualTo(102);
        assertThat(c.rawIngredient(" toor DAL (dry) ")).contains("Toor dal (dry)");
        assertThat(c.rawIngredient("Moonrock")).isEmpty();
        assertThat(c.rawIngredientNames()).contains("Toor dal (dry)");
        AiContent.ExerciseCard card = c.exerciseCard("Goblet Squat").orElseThrow();
        assertThat(card.keyCues()).contains("Sit down between your heels with your chest up");
        assertThat(card.commonMistakes()).isNotEmpty();
        assertThat(c.exerciseCard("My Secret Lift")).isEmpty();
    }
}
