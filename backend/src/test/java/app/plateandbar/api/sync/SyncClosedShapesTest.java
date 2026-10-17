package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Contract 0.1.18 (#720, #646): every nested object the contract fully lists is closed, so an extra key is refused by
 * the schema validation, and the objects that stay open (WorkoutExercise) still take unlisted scalar keys. Each case
 * is checked with and without the extra key, so a fixture that is wrong cannot make a refusal pass.
 */
class SyncClosedShapesTest {

    private static final String USER = "6f1c2a3e-1b2c-4d5e-8f90-1234567890ab";
    private static final String AT = "2026-10-08T09:00:00Z";
    private static final SyncRequestValidator VALIDATOR = new SyncRequestValidator();
    private static final String TAGS = "{'pattern':'push','family':'press','equipment':'barbell','difficulty':2,"
            + "'primary':['chest'],'secondary':[],'joints':['shoulder']}";
    private static final String SESSION = "{'date':'2026-10-01','sets':[{'weight_kg':50,'reps':8,'rate':'right'}],'form':'yes'";

    /** A case: the table, how to make the fixture carry the nested object, and where an extra key goes. */
    private record Shape(String name, SyncTable table, Consumer<ObjectNode> setup, Consumer<ObjectNode> addExtra) {
        @Override
        public String toString() {
            return name;
        }
    }

    private static Shape shape(String name, SyncTable table, Consumer<ObjectNode> setup, java.util.function.Function<ObjectNode, JsonNode> target) {
        return new Shape(name, table, setup, r -> ((ObjectNode) target.apply(r)).put("zz_extra", 1));
    }

    private static void set(ObjectNode r, String field, String singleQuotedJson) {
        r.set(field, SyncFixtures.obj("{'v':" + singleQuotedJson + "}").get("v"));
    }

    static Stream<Shape> closed() {
        return Stream.of(
                shape("Profile.targets", SyncTable.profiles, r -> { }, r -> r.get("targets")),
                shape("LiftStat.sets[]", SyncTable.lift_stats, r -> { }, r -> r.get("sets").get(0)),
                shape("LiftStat.history[]", SyncTable.lift_stats, r -> { }, r -> r.get("history").get(0)),
                shape("LiftStat.prev", SyncTable.lift_stats, r -> set(r, "prev", SESSION + "}"), r -> r.get("prev")),
                shape("LiftStat.prev.sets[]", SyncTable.lift_stats, r -> set(r, "prev", SESSION + "}"), r -> r.get("prev").get("sets").get(0)),
                shape("LiftStat.prev.prev", SyncTable.lift_stats, r -> set(r, "prev", SESSION + ",'prev':" + SESSION + "}}"),
                        r -> r.get("prev").get("prev")),
                shape("Recipe.ingredients[]", SyncTable.recipes, r -> { }, r -> r.get("ingredients").get(0)),
                shape("KitchenTest.ingredients[]", SyncTable.kitchen_tests,
                        r -> set(r, "ingredients", "[{'ingredient':'Rice','amount':100,'unit':'g'}]"), r -> r.get("ingredients").get(0)),
                shape("Settings.water_sizes", SyncTable.settings, r -> { }, r -> r.get("water_sizes")),
                shape("Settings.custom_tags[]", SyncTable.settings, r -> set(r, "custom_tags", "{'My Lift':" + TAGS + "}"),
                        r -> r.get("custom_tags").get("My Lift")),
                shape("Settings.exercise_overrides[]", SyncTable.settings,
                        r -> set(r, "exercise_overrides", "{'My Lift':{'type':'barbell','step_kg':2.5,'rep_low':6,'rep_high':10}}"),
                        r -> r.get("exercise_overrides").get("My Lift")),
                shape("Settings.flex[]", SyncTable.settings,
                        r -> set(r, "flex", "[{'id':'2a7d9c4e-5b1f-4a3e-8c6d-0e9f1b2a3c4d','date':'2026-10-08','kcal_delta':200}]"),
                        r -> r.get("flex").get(0)),
                shape("Settings.returning[]", SyncTable.settings, r -> set(r, "returning", "{'My Lift':{'until':'2026-10-20'}}"),
                        r -> r.get("returning").get("My Lift")),
                shape("Settings.reminders[]", SyncTable.settings,
                        r -> set(r, "reminders", "[{'kind':'workout','time':'07:00','days':[1],'on':true}]"), r -> r.get("reminders").get(0)));
    }

    private static List<ErrorResponse.Detail> push(SyncTable table, ObjectNode record) {
        String raw = Req.of(null).add(table, record).build().toString();
        ApiException e = catchThrowableOfType(ApiException.class,
                () -> VALIDATOR.validate(USER, SyncFixtures.JSON.readTree(raw), raw.getBytes(StandardCharsets.UTF_8)));
        return e == null ? null : e.details();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("closed")
    void anExtraKeyInAClosedShapeIsRefused(Shape s) {
        ObjectNode record = SyncFixtures.oneOfEach(USER, AT).get(s.table());
        s.setup().accept(record);
        assertThat(push(s.table(), record)).as("without the extra key").isNull();

        s.addExtra().accept(record);
        List<ErrorResponse.Detail> refused = push(s.table(), record);
        assertThat(refused).as("with the extra key").isNotNull().isNotEmpty();
        // A oneOf (LiftStat.prev) adds its own wrapper issues beside the closing keyword's.
        assertThat(refused).extracting(ErrorResponse.Detail::issue)
                .anyMatch(i -> i.equals("additionalProperties") || i.equals("unevaluatedProperties"));
        assertThat(refused.toString()).doesNotContain("zz_extra"); // an unknown key is never echoed (#419)
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("closed")
    void theTopLevelOfARecordStaysOpen(Shape s) {
        ObjectNode record = SyncFixtures.oneOfEach(USER, AT).get(s.table());
        s.setup().accept(record);
        record.put("zz_extra", 1);
        assertThat(push(s.table(), record)).isNull();
    }

    @org.junit.jupiter.api.Test
    void aWorkoutExerciseStaysOpenForScalarKeysAndBoundsTheRest() {
        ObjectNode record = SyncFixtures.oneOfEach(USER, AT).get(SyncTable.workouts);
        ObjectNode exercise = (ObjectNode) record.get("exercises").get(0);
        exercise.put("newer_flag", true).put("newer_text", "x").putNull("newer_null").put("newer_n", 1.5);
        assertThat(push(SyncTable.workouts, record)).isNull();

        exercise.put("newer_long", "x".repeat(201));
        assertThat(push(SyncTable.workouts, record)).isNotNull();
        exercise.remove("newer_long");
        exercise.putObject("newer_obj");
        assertThat(push(SyncTable.workouts, record)).isNotNull();
        exercise.remove("newer_obj");
        for (int i = 0; i < 20; i++) {
            exercise.put("k" + i, 1);
        }
        assertThat(push(SyncTable.workouts, record)).as("more than 20 keys").isNotNull();
    }
}
