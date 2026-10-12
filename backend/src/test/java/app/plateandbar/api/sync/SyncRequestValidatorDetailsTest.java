package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.foodLog;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Pins the exact error details (field path and keyword) the schema validator produces for bad sync requests, so a
 * validator library upgrade (#416) cannot change what clients see.
 */
class SyncRequestValidatorDetailsTest {

    private static final String USER = "6f1c2a3e-1b2c-4d5e-8f90-1234567890ab";
    private static final String AT = "2026-10-08T09:00:00Z";
    private static final SyncRequestValidator VALIDATOR = new SyncRequestValidator();

    private static ObjectNode food(Consumer<ObjectNode> edit) {
        ObjectNode r = foodLog(id(), 0, AT, null, "Oats", 300);
        edit.accept(r);
        return Req.of(null).add(SyncTable.food_logs, r).build();
    }

    private static ObjectNode water(Consumer<ObjectNode> edit) {
        ObjectNode r = waterLog(id(), 0, AT, null, 250);
        edit.accept(r);
        return Req.of(null).add(SyncTable.water_logs, r).build();
    }

    private static ObjectNode exclusion(String json) {
        ObjectNode r = SyncFixtures.oneOfEach(USER, AT).get(SyncTable.exclusions);
        r.setAll(SyncFixtures.obj(json));
        return Req.of(null).add(SyncTable.exclusions, r).build();
    }

    private static ErrorResponse.Detail d(String field, String issue) {
        return new ErrorResponse.Detail(field, issue);
    }

    static Stream<Arguments> cases() {
        return Stream.of(
                Arguments.of("missing field", food(r -> r.remove("name")), List.of(d("changes.food_logs[0].name", "required"))),
                Arguments.of("bad enum", food(r -> r.put("meal", "Brunch")), List.of(d("changes.food_logs[0].meal", "enum"))),
                Arguments.of("wrong type", water(r -> r.put("ml", "lots")), List.of(d("changes.water_logs[0].ml", "type"))),
                Arguments.of("unknown field (accepted; the service ignores it)", water(r -> r.put("colour", "blue")), null),
                Arguments.of("bad date-time", water(r -> r.put("updated_at", "yesterday")), List.of(d("changes.water_logs[0].updated_at", "format"))),
                Arguments.of("bad uuid", water(r -> r.put("id", "not-a-uuid")), List.of(d("changes.water_logs[0].id", "format"))),
                Arguments.of("bad date", water(r -> r.put("date", "2026-13-40")), List.of(d("changes.water_logs[0].date", "format"))),
                Arguments.of("negative version", water(r -> r.put("version", -1)), List.of(d("changes.water_logs[0].version", "minimum"))),
                Arguments.of("two problems", food(r -> {
                    r.remove("kcal");
                    r.put("qty", "one");
                }), List.of(d("changes.food_logs[0].qty", "type"), d("changes.food_logs[0].kcal", "required"))),
                Arguments.of("unknown table", (ObjectNode) Req.of(null).build().set("changes",
                        SyncFixtures.obj("{'meals':[]}")), List.of(d("changes", "additionalProperties")) /* the key is never echoed (#419) */),
                Arguments.of("cursor type", (ObjectNode) Req.of(null).build().put("cursor", 5), List.of(d("cursor", "type"))),
                Arguments.of("exclusion key too long", exclusion("{'to':{'%s':null}}".formatted("x".repeat(201))),
                        List.of(d("changes.exclusions[0].to", "propertyNames"))), // the key is never echoed (#419)
                Arguments.of("missing changes", (ObjectNode) SyncFixtures.obj("{'cursor':null}"), List.of(d("changes", "required"))));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    /** {@code expected} null: the request is valid. */
    void details(String name, ObjectNode body, List<ErrorResponse.Detail> expected) {
        ApiException e = catchThrowableOfType(ApiException.class, () -> VALIDATOR.validate(USER, body));
        if (expected == null) {
            assertThat(e).isNull();
        } else {
            assertThat(e).isNotNull();
            assertThat(e.details()).isEqualTo(expected);
        }
    }
}
