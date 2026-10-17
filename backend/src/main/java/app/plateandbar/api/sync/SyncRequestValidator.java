package app.plateandbar.api.sync;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.dataformat.yaml.YAMLMapper;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaRegistryConfig;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Validates a {@code POST /sync} body against the schemas in the contract ({@code packages/api/openapi.yaml},
 * put on the classpath by Gradle's {@code processResources}, so there is no second copy), then
 * applies the rules a schema cannot express. Any problem rejects the whole request with 400
 * {@code invalid_request}. Details name the field and the failed keyword only, never the value.
 */
@Component
public class SyncRequestValidator {

    static final int MAX_RECORDS = 500;
    private static final int MAX_DETAILS = 20;
    private static final String DIALECT = "https://json-schema.org/draft/2020-12/schema";

    /** A pushed record, parsed. Timestamps are as sent; the service clamps them. */
    record Incoming(
            SyncTable table, String id, int version, Instant updatedAt, Instant deletedAt, ObjectNode data) {}

    /** {@code cursor} is null on a first sync. */
    record Parsed(String cursor, List<Incoming> records) {}

    private final Schema requestSchema;
    private final Map<SyncTable, Set<String>> fields = new java.util.EnumMap<>(SyncTable.class);

    public SyncRequestValidator() {
        JsonNode components;
        try (InputStream in = SyncRequestValidator.class.getResourceAsStream("/openapi.yaml")) {
            components = new YAMLMapper().readTree(in).path("components");
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("openapi.yaml cannot be read", e);
        }
        ObjectMapper json = new ObjectMapper();
        ObjectNode wrapper = json.createObjectNode();
        wrapper.put("$schema", DIALECT);
        wrapper.put("$ref", "#/components/schemas/SyncRequest");
        wrapper.set("components", components);
        this.requestSchema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
                b -> b.schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build())).getSchema(wrapper);
        for (SyncTable t : SyncTable.values()) {
            fields.put(t, recordFields(components.path("schemas"), components.path("schemas").path(schemaName(t))));
        }
    }

    public Parsed validate(String userId, JsonNode body) {
        if (body == null || !body.isObject()) {
            throw invalid(List.of(new ErrorResponse.Detail("", "type")));
        }
        // Count before the (costlier) schema walk, so an oversized request is refused cheaply.
        int claimed = 0;
        for (JsonNode list : body.path("changes")) {
            claimed += list.isArray() ? list.size() : 0;
        }
        if (claimed > MAX_RECORDS) {
            throw invalid(List.of(new ErrorResponse.Detail("changes", "too_many_records")));
        }
        List<ErrorResponse.Detail> problems = new ArrayList<>();
        for (com.networknt.schema.Error m : requestSchema.validate(body)) {
            problems.add(detail(m));
        }
        if (!problems.isEmpty()) {
            throw invalid(problems);
        }

        String cursor = body.path("cursor").isNull() ? null : body.path("cursor").asString();
        if (cursor != null && Cursor.parse(cursor).isEmpty()) {
            throw invalid(List.of(new ErrorResponse.Detail("cursor", "format")));
        }

        UUID namespace = UUID.fromString(userId);
        List<Incoming> records = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int total = 0;
        for (SyncTable table : SyncTable.values()) {
            JsonNode list = body.path("changes").path(table.name());
            for (int i = 0; i < list.size(); i++) {
                total++;
                String path = "changes." + table.name() + "[" + i + "]";
                if (total > MAX_RECORDS) {
                    throw invalid(List.of(new ErrorResponse.Detail("changes", "too_many_records")));
                }
                records.add(parse(table, list.get(i), path, namespace, seen));
            }
        }
        return new Parsed(cursor, records);
    }

    private Incoming parse(SyncTable table, JsonNode rec, String path, UUID namespace, Set<String> seen) {
        String id = rec.path("id").asString().toLowerCase(java.util.Locale.ROOT);
        if (!Uuids.isCanonical(id)) {
            throw invalid(List.of(new ErrorResponse.Detail(path + ".id", "format")));
        }
        if (!seen.add(table.name() + "/" + id)) {
            throw invalid(List.of(new ErrorResponse.Detail(path + ".id", "duplicate")));
        }
        if (table.naturalKey(rec).isPresent()) {
            String expected = Uuids.v5(namespace, table.name() + ":" + table.naturalKey(rec).get()).toString();
            if (!expected.equals(id)) {
                throw invalid(List.of(new ErrorResponse.Detail(path + ".id", "natural_key_id")));
            }
        }
        if (!rec.path("version").canConvertToInt()) {
            throw invalid(List.of(new ErrorResponse.Detail(path + ".version", "maximum")));
        }
        Instant updatedAt = instant(rec.path("updated_at"), path + ".updated_at");
        Instant deletedAt = rec.path("deleted_at").isNull() ? null : instant(rec.path("deleted_at"), path + ".deleted_at");

        ObjectNode data = new ObjectMapper().createObjectNode();
        for (String f : fields.get(table)) {
            if (rec.has(f)) {
                data.set(f, rec.get(f));
            }
        }
        return new Incoming(table, id, rec.path("version").asInt(), updatedAt, deletedAt, data);
    }

    private static Instant instant(JsonNode node, String path) {
        try {
            return OffsetDateTime.parse(node.asString()).toInstant();
        } catch (DateTimeParseException e) {
            throw invalid(List.of(new ErrorResponse.Detail(path, "format")));
        }
    }

    private static ErrorResponse.Detail detail(com.networknt.schema.Error m) {
        StringBuilder path = new StringBuilder();
        // The validator reports a JSON pointer such as /changes/food_logs/0/meal; the contract wants a path. Only the
        // segments named by the contract are kept: the path stops where it enters an open map, whose keys the client
        // chose (a custom exercise name), so no submitted key is ever echoed (#419).
        String[] instance = m.getInstanceLocation().toString().split("/");
        int kept = contractSegments(m.getEvaluationPath().toString());
        for (int i = 1; i <= kept && i < instance.length; i++) {
            appendSegment(path, instance[i]);
        }
        // Only `required` names a property of the contract (for other keywords it can be the client's key), and only
        // when the path was not cut at an open map: inside a map value the missing field has no contract path.
        if ("required".equals(m.getKeyword()) && kept >= instance.length - 1) {
            appendSegment(path, m.getProperty());
        }
        return new ErrorResponse.Detail(path.toString(), m.getKeyword());
    }

    /**
     * How many instance segments the evaluation path walks through by name or index: each {@code properties/<name>}
     * and {@code items} step is one; {@code $ref}, {@code allOf/<n>} and the like are none; it stops at the first
     * step into an open map ({@code additionalProperties}, {@code patternProperties}, {@code propertyNames}) or any
     * other keyword. {@code prefixItems/<n>} counts as one, like {@code items}.
     */
    static int contractSegments(String evaluationPath) {
        String[] t = evaluationPath.split("/");
        int n = 0;
        for (int i = 1; i < t.length; i++) {
            switch (t[i]) {
                case "properties", "prefixItems" -> {
                    n++;
                    i++; // the property name or item index
                }
                case "items" -> n++;
                case "$ref", "if", "then", "else", "not" -> { }
                case "allOf", "anyOf", "oneOf", "dependentSchemas" -> i++; // the branch index or property name
                default -> {
                    return n;
                }
            }
        }
        return n;
    }

    private static void appendSegment(StringBuilder path, String segment) {
        if (segment == null || segment.isEmpty()) {
            return;
        }
        String s = segment.replace("~1", "/").replace("~0", "~");
        if (s.chars().allMatch(Character::isDigit)) {
            path.append('[').append(s).append(']');
        } else {
            path.append(path.length() == 0 ? "" : ".").append(s);
        }
    }

    private static ApiException invalid(List<ErrorResponse.Detail> details) {
        List<ErrorResponse.Detail> capped = new ArrayList<>(new LinkedHashSet<>(details));
        if (capped.size() > MAX_DETAILS) {
            capped = capped.subList(0, MAX_DETAILS);
        }
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "The request is not valid.", capped);
    }

    private static String schemaName(SyncTable t) {
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

    /** Names of the record's own fields: every property reachable through allOf and $ref, minus the meta fields. */
    private static Set<String> recordFields(JsonNode schemas, JsonNode schema) {
        Set<String> names = new LinkedHashSet<>();
        collect(schemas, schema, names);
        names.removeAll(Set.of("id", "version", "updated_at", "deleted_at"));
        return names;
    }

    private static void collect(JsonNode schemas, JsonNode schema, Set<String> names) {
        if (schema.has("$ref")) {
            String ref = schema.get("$ref").asString();
            collect(schemas, schemas.path(ref.substring(ref.lastIndexOf('/') + 1)), names);
        }
        schema.path("properties").propertyNames().forEach(names::add);
        for (JsonNode part : schema.path("allOf")) {
            collect(schemas, part, names);
        }
    }
}
