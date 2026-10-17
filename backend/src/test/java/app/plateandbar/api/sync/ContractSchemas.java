package app.plateandbar.api.sync;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.dataformat.yaml.YAMLMapper;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaRegistryConfig;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

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

    /** The {@code default} example of a named response, for example {@code AccountFull}. */
    static JsonNode responseExample(String name) {
        return COMPONENTS.path("responses").path(name).path("content").path("application/json")
                .path("examples").path("default").path("value");
    }

    /** Validation problems for {@code value} against {@code components.schemas.<name>}; empty when it conforms. */
    public static List<com.networknt.schema.Error> validate(String name, JsonNode value) {
        ObjectNode wrapper = new ObjectMapper().createObjectNode();
        wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        wrapper.put("$ref", "#/components/schemas/" + name);
        wrapper.set("components", COMPONENTS);
        return SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
                        b -> b.schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()))
                .getSchema(wrapper)
                .validate(value);
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
