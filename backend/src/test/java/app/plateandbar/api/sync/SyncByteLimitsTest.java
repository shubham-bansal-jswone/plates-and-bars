package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** x-max-json-bytes (contract 0.1.18, #720) enforced by the validator on the raw request bytes. */
class SyncByteLimitsTest {

    private static final String USER = "6f1c2a3e-1b2c-4d5e-8f90-1234567890ab";
    private static final String AT = "2026-10-08T09:00:00Z";
    private static final SyncRequestValidator VALIDATOR = new SyncRequestValidator();
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Settings with {@code field} set to {@code valueJson}, as the raw body text (the value is spliced in unchanged). */
    private static String body(String field, String valueJson) throws Exception {
        ObjectNode settings = SyncFixtures.oneOfEach(USER, AT).get(SyncTable.settings);
        settings.set(field, JSON.readTree("null"));
        String json = Req.of(null).add(SyncTable.settings, settings).build().toString();
        return json.replace("\"" + field + "\":null", "\"" + field + "\":" + valueJson);
    }

    private static List<ErrorResponse.Detail> refusal(String raw) throws Exception {
        JsonNode parsed = JSON.readTree(raw);
        ApiException e = catchThrowableOfType(ApiException.class,
                () -> VALIDATOR.validate(USER, parsed, raw.getBytes(StandardCharsets.UTF_8)));
        return e == null ? null : e.details();
    }

    /** A JSON object of exactly {@code bytes} bytes compact: {"k":"xxx"}. */
    private static String objectOf(int bytes) {
        return "{\"k\":\"" + "x".repeat(bytes - 8) + "\"}";
    }

    static Stream<Arguments> fields() {
        return Stream.of(Arguments.of("adjustments"), Arguments.of("adaptive"), Arguments.of("learn"), Arguments.of("meal_plan"));
    }

    @ParameterizedTest
    @MethodSource("fields")
    void anObjectOf64KbIsAcceptedAndOneByteMoreIsRefusedAtItsPath(String field) throws Exception {
        assertThat(refusal(body(field, objectOf(65536)))).isNull();
        assertThat(refusal(body(field, objectOf(65537))))
                .containsExactly(new ErrorResponse.Detail("changes.settings[0]." + field, "max_json_bytes"));
    }

    @Test
    void eachPrepBatchHasItsOwn4KbAndTheRefusalNamesTheBatch() throws Exception {
        assertThat(refusal(body("prep", "[" + objectOf(4096) + "," + objectOf(4096) + "]"))).isNull();
        assertThat(refusal(body("prep", "[" + objectOf(100) + "," + objectOf(4097) + "]")))
                .containsExactly(new ErrorResponse.Detail("changes.settings[0].prep[1]", "max_json_bytes"));
    }

    @Test
    void whitespaceDoesNotCountTowardsTheLimit() throws Exception {
        String padded = objectOf(65536).replace(":", " :  ").replace("{", "{\n  ") + "  ";
        assertThat(padded.length()).isGreaterThan(65536);
        assertThat(refusal(body("learn", padded))).isNull();
    }

    /** Re-serialised by Jackson, 1e2 would be 100.0 (5 bytes): as sent it is 3, so this body is exactly at the limit. */
    @Test
    void numbersCountAsSentNotAsReserialised() throws Exception {
        String atLimit = "{\"k\":1e2,\"p\":\"" + "x".repeat(65536 - 16) + "\"}"; // {"k":1e2,"p":"..."}: 16 bytes besides the x
        assertThat(atLimit.getBytes(StandardCharsets.UTF_8)).hasSize(65536);
        assertThat(refusal(body("learn", atLimit))).isNull();
        assertThat(refusal(body("learn", atLimit.replace("1e2", "1e20")))).hasSize(1);
    }

    @Test
    void theLimitIsInUtf8BytesNotCharacters() throws Exception {
        // 30000 two-byte characters inside the object: 30000 chars but 60000 bytes + 8 over the 64 KB with ten more.
        String twoByte = "{\"k\":\"" + "é".repeat(32764) + "\"}"; // 8 + 2*32764 = 65536
        assertThat(twoByte.getBytes(StandardCharsets.UTF_8)).hasSize(65536);
        assertThat(refusal(body("learn", twoByte))).isNull();
        assertThat(refusal(body("learn", twoByte.replace("\"}", "a\"}")))).hasSize(1);
    }

    @Test
    void aSchemaFailureIsReportedWithoutAByteProblemAlongsideIt() throws Exception {
        assertThat(refusal(body("water_sizes", "{}"))).extracting(ErrorResponse.Detail::issue).doesNotContain("max_json_bytes");
    }

    /** If the measuring parse fails, the request is refused: it must never fail open and let a big value through. */
    @Test
    void aMeasuringParseFailureRefusesTheRequest() throws Exception {
        String raw = body("learn", "{}");
        JsonNode parsed = JSON.readTree(raw);
        ApiException e = catchThrowableOfType(ApiException.class,
                () -> VALIDATOR.validate(USER, parsed, "{\"changes\":".getBytes(StandardCharsets.UTF_8)));
        assertThat(e).isNotNull();
        assertThat(e.details()).containsExactly(new ErrorResponse.Detail("", "invalid_json"));
    }

    /** The library logs a warning once per JVM for a keyword it does not know; registering it stops that. */
    @Test
    void theByteKeywordIsKnownToTheSchemaLibrary() {
        assertThat(SyncRequestValidator.REQUEST_DIALECT.getKeywords()).containsKey("x-max-json-bytes");
        assertThat(SyncRequestValidator.REQUEST_DIALECT.getKeywords().get("x-max-json-bytes"))
                .isInstanceOf(com.networknt.schema.keyword.NonValidationKeyword.class);
    }
}
