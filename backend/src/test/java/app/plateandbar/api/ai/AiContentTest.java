package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
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
}
