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
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

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

    /** {@code "METHOD /path status"} of every response {@link #assertResponse} has validated in this JVM. */
    private static final Set<String> RECORDED = ConcurrentHashMap.newKeySet();

    private ContractSchemas() {}

    /** What {@link #assertResponse} has validated so far, for {@code ContractCoverageTest}. */
    static Set<String> recorded() {
        return Set.copyOf(RECORDED);
    }

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

    /** The contract's {@code paths} object, for the per-operation guard. */
    static JsonNode paths() {
        try {
            return new YAMLMapper().readTree(Files.readAllBytes(CONTRACT)).path("paths");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Checks a real response against the contract for {@code operation} (for example {@code "POST /auth/google"}) and
     * {@code status}. The status must be documented. If the contract gives it a JSON schema (inline or through
     * {@code components.responses}) the body must conform; if it gives none (204, 304) the body must be empty.
     * An {@code Error} body may carry only keys the {@code Error} schema lists. Once the check passes, the operation and status are recorded for {@code ContractCoverageTest}.
     */
    public static void assertResponse(String operation, int status, String body) {
        String[] parts = operation.split(" ", 2);
        if (parts.length != 2 || !parts[1].startsWith("/")) {
            throw new AssertionError("operation must be \"METHOD /path\", got: \"" + operation + "\"");
        }
        JsonNode response = paths().path(parts[1]).path(parts[0].toLowerCase()).path("responses").path(String.valueOf(status));
        if (response.isMissingNode()) {
            throw new AssertionError(operation + " documents no " + status + " response");
        }
        if (response.has("$ref")) {
            String ref = response.path("$ref").asString();
            response = COMPONENTS.path("responses").path(ref.substring(ref.lastIndexOf('/') + 1));
        }
        JsonNode schema = response.path("content").path("application/json").path("schema");
        String text = body == null ? "" : body;
        if (schema.isMissingNode()) {
            if (!text.isEmpty()) {
                throw new AssertionError(operation + " " + status + " documents no body, got: " + text.length() + " chars");
            }
            RECORDED.add(operation + " " + status);
            return;
        }
        JsonNode value;
        try {
            value = new ObjectMapper().readTree(text);
        } catch (RuntimeException e) {
            throw new AssertionError(operation + " " + status + " body is not JSON", e);
        }
        ObjectNode wrapper = ((ObjectNode) schema).deepCopy();
        wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        wrapper.set("components", COMPONENTS);
        List<com.networknt.schema.Error> problems = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
                        b -> b.schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()))
                .getSchema(wrapper)
                .validate(value);
        if (!problems.isEmpty()) {
            throw new AssertionError(operation + " " + status + " does not match the contract: " + problems);
        }
        // The contract leaves response objects open, but an Error body must not leak a field it does not list (#883).
        if (schema.path("$ref").asString().endsWith("/schemas/Error")) {
            Set<String> listed = new java.util.HashSet<>();
            schema("Error").path("properties").propertyNames().forEach(listed::add);
            List<String> extra = new java.util.ArrayList<>();
            value.propertyNames().forEach(k -> { if (!listed.contains(k)) extra.add(k); });
            if (!extra.isEmpty()) {
                throw new AssertionError(operation + " " + status + " Error body has keys the Error schema does not list: " + extra);
            }
        }
        RECORDED.add(operation + " " + status);
    }

    /** {@link #assertResponse(String, int, String)} for a body a test client already parsed into a map. */
    public static void assertResponse(String operation, int status, java.util.Map<?, ?> body) {
        assertResponse(operation, status, new ObjectMapper().writeValueAsString(body));
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
            case routines -> "Routine";
        };
    }
}
