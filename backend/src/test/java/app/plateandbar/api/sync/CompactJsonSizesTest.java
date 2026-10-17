package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.sync.CompactJsonSizes.Limit;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The size rule of {@code x-max-json-bytes}: compact JSON, UTF-8, number text as sent. */
class CompactJsonSizesTest {

    private static List<String> over(String json, long bytes) {
        return CompactJsonSizes.overLimit(new tools.jackson.databind.ObjectMapper(), json.getBytes(StandardCharsets.UTF_8),
                Map.of("settings", Map.of("learn", new Limit(bytes, false), "prep", new Limit(bytes, true))));
    }

    /** A body with {@code value} as the learn field of the first settings record. */
    private static String learn(String value) {
        return "{\"cursor\":null,\"changes\":{\"settings\":[{\"learn\": " + value + " }]}}";
    }

    private static boolean fits(String value) {
        String compact = value.replaceAll("\\s", "");
        long exact = compact.getBytes(StandardCharsets.UTF_8).length;
        return over(learn(value), exact).isEmpty() && !over(learn(value), exact - 1).isEmpty();
    }

    @Test
    void whitespaceIsNotCounted() {
        assertThat(fits("{ \"a\" : [ 1 , 2 ] , \"b\" : null }")).isTrue(); // {"a":[1,2],"b":null} = 20 bytes
        assertThat(over(learn("{ \"a\" : [ 1 , 2 ] , \"b\" : null }"), 20)).isEmpty();
        assertThat(over(learn("{ \"a\" : [ 1 , 2 ] , \"b\" : null }"), 19)).containsExactly("changes.settings[0].learn");
    }

    @Test
    void aNumberCountsAsSentNotAsReserialised() {
        // 1e2 is 3 bytes as sent; Jackson would write 100.0 (5) or 100 (3 by chance), and 1.50 is 4 not 3.
        assertThat(over(learn("[1e2]"), 5)).isEmpty();
        assertThat(over(learn("[1e2]"), 4)).hasSize(1);
        assertThat(over(learn("[1.50]"), 6)).isEmpty();
        assertThat(over(learn("[1.50]"), 5)).hasSize(1);
        assertThat(over(learn("[0.00000001]"), 12)).isEmpty();
        assertThat(over(learn("[0.00000001]"), 11)).hasSize(1);
    }

    @Test
    void stringsAreMeasuredInUtf8WithJsonStringifyEscapes() {
        assertThat(fits("\"abc\"")).isTrue();
        assertThat(fits("\"é\"")).isTrue();                 // 2 bytes
        assertThat(fits("\"€\"")).isTrue();                 // 3 bytes
        assertThat(fits("\"😀\"")).isTrue();                // 4 bytes
        assertThat(CompactJsonSizes.quotedSize("é")).isEqualTo(4);
        assertThat(CompactJsonSizes.quotedSize("😀")).isEqualTo(6);
        assertThat(CompactJsonSizes.quotedSize("a\"b\\c\n")).isEqualTo(2 + 1 + 2 + 1 + 2 + 1 + 2);
        assertThat(CompactJsonSizes.quotedSize("\u0001")).isEqualTo(8);   // \u0001
        assertThat(CompactJsonSizes.quotedSize("\ud800")).isEqualTo(8);   // a lone surrogate is written \ud800
        // An escape written by the client counts as the character JSON.stringify would write: \u00e9 is é (2 bytes).
        assertThat(over(learn("[\"\\u00e9\"]"), 6)).isEmpty();
        assertThat(over(learn("[\"\\u00e9\"]"), 5)).hasSize(1);
        // A slash is not escaped by JSON.stringify, whatever the client wrote.
        assertThat(over(learn("[\"\\/\"]"), 5)).isEmpty();
        assertThat(over(learn("[\"\\/\"]"), 4)).hasSize(1);
    }

    @Test
    void keysCountWithQuotesAndColon() {
        assertThat(over(learn("{\"é\":true}"), 11)).isEmpty(); // {"é":true} = 1+4+1+4+1
        assertThat(over(learn("{\"é\":true}"), 10)).hasSize(1);
        assertThat(over(learn("{\"a\":false,\"b\":null}"), 20)).isEmpty();
        assertThat(over(learn("{\"a\":false,\"b\":null}"), 19)).hasSize(1);
    }

    @Test
    void emptyContainersAndNestingAreCounted() {
        assertThat(over(learn("{}"), 2)).isEmpty();
        assertThat(over(learn("{}"), 1)).hasSize(1);
        assertThat(over(learn("[[],{},[[]]]"), 12)).isEmpty();
        assertThat(over(learn("[[],{},[[]]]"), 11)).hasSize(1);
    }

    @Test
    void anItemLimitMeasuresEachItemAndNamesIt() {
        String body = "{\"changes\":{\"settings\":[{\"prep\":[{\"a\":1},{\"a\":1,\"b\":22222}]}]}}";
        assertThat(over(body, 17)).isEmpty();
        assertThat(over(body, 16)).containsExactly("changes.settings[0].prep[1]");
        assertThat(over(body, 6)).containsExactly("changes.settings[0].prep[0]", "changes.settings[0].prep[1]"); // {"a":1} is 7
    }

    @Test
    void onlyTheNamedFieldsOfTheNamedTablesAtTheirPlaceAreMeasured() {
        String big = "\"" + "x".repeat(500) + "\"";
        assertThat(over("{\"changes\":{\"settings\":[{\"other\":" + big + "}]}}", 10)).isEmpty();
        assertThat(over("{\"changes\":{\"weights\":[{\"learn\":" + big + "}]}}", 10)).isEmpty();
        assertThat(over("{\"other\":{\"settings\":[{\"learn\":" + big + "}]}}", 10)).isEmpty();
        assertThat(over("{\"changes\":{\"settings\":[{\"x\":{\"learn\":" + big + "}}]}}", 10)).isEmpty();
        assertThat(over("{\"changes\":{\"settings\":[{\"learn\":" + big + "}]}}", 10)).hasSize(1);
    }

    @Test
    void theIndexOfTheRecordIsInThePath() {
        String body = "{\"changes\":{\"settings\":[{\"learn\":1},{\"learn\":[1,2,3]}]}}";
        assertThat(over(body, 3)).containsExactly("changes.settings[1].learn");
    }
}
