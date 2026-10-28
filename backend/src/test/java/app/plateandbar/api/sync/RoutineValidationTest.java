package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.withMeta;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.plateandbar.api.common.ApiException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** The routine field vectors of the contract against the real request validator (the contract schema, not a copy). */
class RoutineValidationTest {

    private static final String USER = "6f1c2a3e-1b2c-4d5e-8f90-1234567890ab";
    private static final String AT = "2026-10-08T09:00:00Z";
    private static final SyncRequestValidator VALIDATOR = new SyncRequestValidator();

    private static ObjectNode body(JsonNode record) {
        ObjectNode fields = (ObjectNode) record.deepCopy();
        fields.put("created_at", AT);
        return Req.of(null).add(SyncTable.routines, withMeta(fields, id(), 0, AT, null)).build();
    }

    private static ApiException validate(ObjectNode body) {
        return catchThrowableOfType(ApiException.class,
                () -> VALIDATOR.validate(USER, body, body.toString().getBytes(StandardCharsets.UTF_8)));
    }

    static Stream<Arguments> valid() {
        return RoutineVectors.FILE.path("valid").valueStream().map(v -> Arguments.of(v.path("note").asString(), v.path("record")));
    }

    static Stream<Arguments> invalid() {
        return RoutineVectors.FILE.path("invalid").valueStream().map(v -> Arguments.of(v.path("note").asString(), v.path("record")));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("valid")
    void validVectorsPass(String note, JsonNode record) {
        ObjectNode b = body(record);
        assertThat(validate(b)).isNull();
        SyncRequestValidator.Parsed parsed = VALIDATOR.validate(USER, b, b.toString().getBytes(StandardCharsets.UTF_8));
        // Unknown exercise keys are kept (bounded open), and the stored data is exactly name, exercises, created_at.
        assertThat(parsed.records().get(0).data().path("exercises")).isEqualTo(record.path("exercises"));
        assertThat(parsed.records().get(0).data().propertyNames()).containsExactlyInAnyOrder("name", "exercises", "created_at");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalid")
    void invalidVectorsAreRefusedAndNameOnlyThePath(String note, JsonNode record) {
        ApiException e = validate(body(record));
        assertThat(e).as(note).isNotNull();
        assertThat(e.code()).isEqualTo("invalid_request");
        assertThat(e.details()).isNotEmpty();
        assertThat(e.details()).allSatisfy(d -> assertThat(d.field()).startsWith("changes.routines[0]"));
        // Never the value: no detail field carries record text.
        assertThat(e.details().toString()).doesNotContain("Squat");
    }

    @org.junit.jupiter.api.Test
    void theCapComesFromTheContractNotFromCode() {
        ObjectNode b = body(RoutineVectors.FILE.path("valid").get(0).path("record"));
        SyncRequestValidator.Parsed p = VALIDATOR.validate(USER, b, b.toString().getBytes(StandardCharsets.UTF_8));
        assertThat(p.maxLiveRoutines()).isEqualTo(RoutineVectors.FILE.path("limits").path("max_live_routines").asInt());
    }
}
