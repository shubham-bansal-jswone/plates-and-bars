package app.plateandbar.api.sync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;

/** Validates JSON against the named schemas of the real contract, {@code packages/api/openapi.yaml}. */
public final class ContractSchemas {
    static final Path CONTRACT = Path.of("..", "packages", "api", "openapi.yaml");

    private static final JsonNode COMPONENTS;

    static {
        try {
            COMPONENTS = new YAMLMapper().readTree(Files.readAllBytes(CONTRACT)).path("components");
        } catch (IOException e) {
            throw new IllegalStateException("run the tests from backend/ so " + CONTRACT + " resolves", e);
        }
    }

    private ContractSchemas() {}

    static JsonNode schema(String name) {
        return COMPONENTS.path("schemas").path(name);
    }

    /** Validation problems for {@code value} against {@code components.schemas.<name>}; empty when it conforms. */
    public static Set<ValidationMessage> validate(String name, JsonNode value) {
        ObjectNode wrapper = new ObjectMapper().createObjectNode();
        wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        wrapper.put("$ref", "#/components/schemas/" + name);
        wrapper.set("components", COMPONENTS);
        SchemaValidatorsConfig config =
                SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build();
        JsonSchema s = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(wrapper, config);
        return s.validate(value);
    }

    static String schemaNameOf(SyncTable t) {
        return switch (t) {
            case profiles -> "Profile";
            case consents -> "Consent";
            case food_logs -> "FoodLog";
            case water_logs -> "WaterLog";
            case day_notes -> "DayNote";
            case workouts -> "Workout";
            case workout_sets -> "WorkoutSet";
            case lift_stats -> "LiftStat";
            case weights -> "Weight";
            case measurements -> "Measurement";
            case user_foods -> "UserFood";
            case recipes -> "Recipe";
            case kitchen_tests -> "KitchenTest";
            case exclusions -> "Exclusion";
            case swaps -> "Swap";
            case settings -> "Settings";
        };
    }
}
