package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class AiRepliesSuggestTagsTest {

    private final ObjectMapper json = new ObjectMapper();
    private final AiReplies replies = new AiReplies(json, new AiSchemas(), new AiContent(json));

    private ObjectNode ok(String raw) {
        return replies.suggestTags(raw).orElseThrow();
    }

    @Test
    void aGoodReplyPassesThrough() {
        ObjectNode r = ok("{\"pattern\":\"fly\",\"equipment\":\"machine\",\"difficulty\":1,\"primary\":[\"chest\"],"
                + "\"secondary\":[\"front-delt\"],\"joints\":[\"shoulder\"]}");
        assertThat(r.toString()).isEqualTo("{\"pattern\":\"fly\",\"equipment\":\"machine\",\"difficulty\":1,"
                + "\"primary\":[\"chest\"],\"secondary\":[\"front-delt\"],\"joints\":[\"shoulder\"]}");
    }

    @Test
    void unknownMusclesAreDroppedBeforeTheCapOfThree() {
        ObjectNode r = ok("{\"primary\":[\"x\",\"chest\",\"lats\",\"abs\",\"calves\"],\"secondary\":[7,\"hams\"]}");
        assertThat(r.path("primary")).extracting(n -> n.asText()).containsExactly("chest", "lats", "abs");
        assertThat(r.path("secondary")).extracting(n -> n.asText()).containsExactly("hams");
    }

    @Test
    void equipmentAndDifficultyFallBack() {
        assertThat(ok("{}").path("equipment").asText()).isEqualTo("machine");
        assertThat(ok("{}").path("difficulty").asInt()).isEqualTo(2);
        for (String d : new String[] {"0", "4", "1.5", "\"2\"", "null", "99999999999"}) {
            assertThat(ok("{\"difficulty\":" + d + "}").path("difficulty").asInt()).as(d).isEqualTo(2);
        }
        assertThat(ok("{\"difficulty\":3,\"equipment\":\"Barbell\"}").path("difficulty").asInt()).isEqualTo(3);
        assertThat(ok("{\"equipment\":\"Barbell\"}").path("equipment").asText()).isEqualTo("machine");
        assertThat(ok("{\"equipment\":\"barbell\"}").path("equipment").asText()).isEqualTo("barbell");
    }

    @Test
    void patternAndJointsAreCutToTheSchemaLimitsButOtherwisePassedThrough() {
        assertThat(ok("{\"pattern\":\"" + "p".repeat(50) + "\"}").path("pattern").asText()).hasSize(50);
        assertThat(ok("{\"pattern\":\"" + "p".repeat(51) + "\"}").path("pattern").asText()).isEmpty();
        assertThat(ok("{\"pattern\":12}").path("pattern").asText()).isEmpty();
        assertThat(ok("{\"pattern\":\"made-up\"}").path("pattern").asText()).isEqualTo("made-up");
        StringBuilder many = new StringBuilder("[");
        for (int i = 0; i < 30; i++) {
            many.append(i == 0 ? "" : ",").append("\"j").append(i).append("\"");
        }
        assertThat(ok("{\"joints\":" + many + "],\"pattern\":\"a\"}").path("joints")).hasSize(20);
        assertThat(ok("{\"joints\":[\"" + "j".repeat(51) + "\",3,\"knee\"]}").path("joints"))
                .extracting(n -> n.asText()).containsExactly("knee");
    }

    @Test
    void noMainMuscleStillAnswersWithEmptyPrimary() {
        assertThat(ok("{\"primary\":[\"nope\"]}").path("primary")).isEmpty();
        assertThat(ok("{\"primary\":\"chest\"}").path("primary")).isEmpty();
    }

    @Test
    void onlyAnUnparseableReplyIsRejected() {
        for (String raw : new String[] {"not json", "[]", "\"x\"", "", "{\"a\":"}) {
            assertThat(replies.suggestTags(raw)).as(raw).isEmpty();
        }
    }

    @Test
    void extraKeysFromTheModelAreNotPassedOn() {
        assertThat(ok("{\"primary\":[\"abs\"],\"note\":\"leak\"}").has("note")).isFalse();
    }
}
