package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.sync.ContractSchemas;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

class OffMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String CODE = "8901491101837";

    private static JsonNode json(String s) {
        return JSON.readTree(s);
    }

    private static ObjectNode mapped(String productJson) {
        Optional<ObjectNode> out = OffMapper.map(CODE, json(productJson));
        assertThat(out).isPresent();
        assertThat(ContractSchemas.validate("OffProduct", out.get())).isEmpty();
        return out.get();
    }

    @Test
    void mapsTheLaysExampleAndConformsToTheContract() {
        ObjectNode out = mapped("""
                {"code":"0008901491101837","product_name":"India's Magic Masala","brands":"Lay's","quantity":"50g",
                 "nutrition_data_per":"100g","completeness":0.8875,"last_modified_t":1780391671,
                 "states_tags":["en:nutrition-facts-completed"],"data_quality_errors_tags":[],"countries_tags":["en:india"],
                 "nutriments":{"energy-kcal_100g":554,"energy-kj_100g":2311.4,"energy":2311.4,"proteins_100g":6.5,
                   "carbohydrates_100g":52,"fat_100g":35,"fiber_100g":3.5,"sugars_100g":1.2,"salt_100g":1.1}}
                """);
        assertThat(out.path("code").asString()).as("the request code, never the upstream one").isEqualTo(CODE);
        assertThat(out.path("name").asString()).isEqualTo("India's Magic Masala");
        assertThat(out.path("serving_size").isNull()).isTrue();
        assertThat(out.path("serving_quantity").isNull()).isTrue();
        assertThat(out.path("last_modified_at").asString()).isEqualTo("2026-06-02T09:14:31Z");
        assertThat(out.path("source").path("url").asString()).isEqualTo("https://world.openfoodfacts.org/product/" + CODE);
        assertThat(out.path("nutriments").propertyNames()).containsExactlyInAnyOrder(
                "energy-kcal_100g", "energy-kj_100g", "proteins_100g", "carbohydrates_100g", "fat_100g", "fiber_100g");
        assertThat(out.path("nutriments").path("energy-kcal_100g").toString()).isEqualTo("554");
        assertThat(out.path("nutriments").path("energy-kj_100g").doubleValue()).isEqualTo(2311.4);
    }

    @Test
    void onlyTheWhitelistedFieldsAreReturned() {
        ObjectNode out = mapped("""
                {"product_name":"x","image_url":"https://img","ingredients_text":"secret","code":"1",
                 "nutriments":{"proteins_100g":1,"nutriscore_score":4,"salt_100g":2}}
                """);
        assertThat(out.propertyNames()).containsExactlyInAnyOrder("code", "name", "brands", "quantity", "serving_size",
                "serving_quantity", "nutrition_data_per", "nutriments", "completeness", "states_tags",
                "data_quality_errors_tags", "countries_tags", "last_modified_at", "source");
        assertThat(out.path("nutriments").propertyNames()).containsExactly("proteins_100g");
    }

    @Test
    void negativeNonFiniteAndNonNumericNutrimentsAreDroppedNotZeroed() {
        JsonNode n = mapped("""
                {"nutriments":{"energy-kcal_100g":-5,"energy-kj_100g":"NaN","proteins_100g":"Infinity",
                  "carbohydrates_100g":"abc","fat_100g":1e999,"fiber_100g":"0x1p3","added-sugars_100g":"12d",
                  "proteins_serving":true,"fat_serving":null,"energy-kcal_serving":[1],"carbohydrates_serving":{},
                  "fiber_serving":"","energy-kj_serving":"1e1000","added-sugars_serving":"7"}}
                """).path("nutriments");
        assertThat(n.propertyNames()).containsExactly("added-sugars_serving");
        assertThat(n.path("added-sugars_serving").toString()).isEqualTo("7");
    }

    @Test
    void numericStringsAreReadAndZeroIsKept() {
        JsonNode n = mapped("""
                {"nutriments":{"proteins_100g":"12.5","fat_100g":0,"fiber_100g":" 3 ","carbohydrates_100g":"1e1","energy-kcal_100g":".5"}}
                """).path("nutriments");
        assertThat(n.path("proteins_100g").doubleValue()).isEqualTo(12.5);
        assertThat(n.path("fat_100g").toString()).isEqualTo("0");
        assertThat(n.path("fiber_100g").toString()).isEqualTo("3");
        assertThat(n.path("carbohydrates_100g").toString()).isEqualTo("10");
        assertThat(n.path("energy-kcal_100g").doubleValue()).isEqualTo(0.5);
    }

    @Test
    void noSurvivingNutrimentMeansNoProduct() {
        assertThat(OffMapper.map(CODE, json("{\"product_name\":\"x\"}"))).isEmpty();
        assertThat(OffMapper.map(CODE, json("{\"nutriments\":{}}"))).isEmpty();
        assertThat(OffMapper.map(CODE, json("{\"nutriments\":{\"sugars_100g\":3,\"energy\":100,\"proteins_100g\":-1}}"))).isEmpty();
        assertThat(OffMapper.map(CODE, json("{\"nutriments\":[1]}"))).isEmpty();
        assertThat(OffMapper.map(CODE, json("[]"))).isEmpty();
        assertThat(OffMapper.map(CODE, null)).isEmpty();
    }

    @Test
    void servingQuantityNeedsToBePositiveAndFinite() {
        for (String bad : new String[] {"0", "-3", "\"abc\"", "\"NaN\"", "1e999", "null", "[]"}) {
            assertThat(mapped("{\"serving_quantity\":" + bad + ",\"nutriments\":{\"fat_100g\":1}}").path("serving_quantity").isNull())
                    .as(bad).isTrue();
        }
        assertThat(mapped("{\"serving_quantity\":\"45\",\"nutriments\":{\"fat_100g\":1}}").path("serving_quantity").toString()).isEqualTo("45");
        assertThat(mapped("{\"serving_quantity\":12.5,\"nutriments\":{\"fat_100g\":1}}").path("serving_quantity").doubleValue()).isEqualTo(12.5);
    }

    @Test
    void textIsStrippedTrimmedAndCapped() {
        String longName = "a".repeat(300);
        ObjectNode out = mapped("{\"product_name\":\"  Choc\\u0000olate\\n\\tbar\\u2028 \",\"brands\":\"" + longName
                + "\",\"quantity\":\"\\u0007\",\"serving_size\":\"" + "b".repeat(150) + "\",\"nutriments\":{\"fat_100g\":1}}");
        assertThat(out.path("name").asString()).isEqualTo("Chocolatebar");
        assertThat(out.path("brands").asString()).hasSize(200);
        assertThat(out.path("quantity").isNull()).as("only control characters: nothing left").isTrue();
        assertThat(out.path("serving_size").asString()).hasSize(100);
    }

    @Test
    void capsCountCodePointsNotUtf16Units() {
        String emoji = "\uD83C\uDF6B".repeat(150);
        ObjectNode out = mapped("{\"product_name\":\"" + emoji + "\",\"nutriments\":{\"fat_100g\":1}}");
        assertThat(out.path("name").asString().codePointCount(0, out.path("name").asString().length())).isEqualTo(150);
        ObjectNode longer = mapped("{\"product_name\":\"" + "\uD83C\uDF6B".repeat(250) + "\",\"nutriments\":{\"fat_100g\":1}}");
        assertThat(longer.path("name").asString().codePointCount(0, longer.path("name").asString().length())).isEqualTo(200);
    }

    @Test
    void nonStringTextIsNull() {
        ObjectNode out = mapped("{\"product_name\":5,\"brands\":[\"x\"],\"quantity\":{},\"nutriments\":{\"fat_100g\":1}}");
        assertThat(out.path("name").isNull()).isTrue();
        assertThat(out.path("brands").isNull()).isTrue();
        assertThat(out.path("quantity").isNull()).isTrue();
    }

    @Test
    void tagsAreFilteredAndCapped() {
        StringBuilder many = new StringBuilder("[");
        for (int i = 0; i < 80; i++) {
            many.append(i == 0 ? "" : ",").append("\"en:t").append(i).append('"');
        }
        many.append(",\"").append("x".repeat(101)).append("\",5,null,\"\"]");
        ObjectNode out = mapped("{\"states_tags\":" + many + ",\"countries_tags\":\"en:india\",\"nutriments\":{\"fat_100g\":1}}");
        assertThat(out.path("states_tags")).hasSize(50);
        assertThat(out.path("countries_tags").isArray()).isTrue();
        assertThat(out.path("countries_tags")).isEmpty();
        out = mapped("{\"states_tags\":[\"" + "y".repeat(100) + "\",\"" + "z".repeat(101) + "\",\"en:ok\"],\"nutriments\":{\"fat_100g\":1}}");
        assertThat(out.path("states_tags")).hasSize(2);
    }

    @Test
    void completenessNutritionDataPerAndModifiedTimeAreChecked() {
        ObjectNode ok = mapped("{\"completeness\":\"0.5\",\"nutrition_data_per\":\"serving\",\"last_modified_t\":\"0\",\"nutriments\":{\"fat_100g\":1}}");
        assertThat(ok.path("completeness").doubleValue()).isEqualTo(0.5);
        assertThat(ok.path("nutrition_data_per").asString()).isEqualTo("serving");
        assertThat(ok.path("last_modified_at").asString()).isEqualTo("1970-01-01T00:00:00Z");
        for (String bad : new String[] {"1.5", "-0.1", "\"x\""}) {
            assertThat(mapped("{\"completeness\":" + bad + ",\"nutriments\":{\"fat_100g\":1}}").path("completeness").isNull()).as(bad).isTrue();
        }
        ObjectNode odd = mapped("{\"nutrition_data_per\":\"1 kg\",\"last_modified_t\":-5,\"nutriments\":{\"fat_100g\":1}}");
        assertThat(odd.path("nutrition_data_per").isNull()).isTrue();
        assertThat(odd.path("last_modified_at").isNull()).isTrue();
        assertThat(mapped("{\"last_modified_t\":99999999999999,\"nutriments\":{\"fat_100g\":1}}").path("last_modified_at").isNull()).isTrue();
    }
}
