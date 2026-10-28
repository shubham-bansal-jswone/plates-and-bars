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
import com.networknt.schema.dialect.Dialect;
import com.networknt.schema.dialect.Dialects;
import com.networknt.schema.keyword.NonValidationKeyword;
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
    /** {@code x-max-json-bytes} limits by table name then field, read from the contract; see CompactJsonSizes. */
    private final Map<String, Map<String, CompactJsonSizes.Limit>> byteLimits = new java.util.HashMap<>();

    static final String MAX_JSON_BYTES = "x-max-json-bytes";

    /**
     * Draft 2020-12 plus {@code x-max-json-bytes}, which CompactJsonSizes checks, not the schema library. Registered
     * as a keyword that validates nothing, so the library does not log "Unknown keyword" for it.
     */
    static final Dialect REQUEST_DIALECT =
            Dialect.builder(Dialects.getDraft202012()).keyword(new NonValidationKeyword(MAX_JSON_BYTES)).build();

    private final ObjectMapper reader;

    /**
     * Contract tables this backend does not implement (the contract's {@code SyncTable} enum minus {@link SyncTable}).
     * A record pushed for one is refused, never dropped; see {@link #validate}.
     */
    private final Set<String> unimplemented = new LinkedHashSet<>();

    /** For tests: a mapper with Jackson's default limits. */
    SyncRequestValidator() {
        this(new ObjectMapper());
    }


    /** {@code reader} is the request mapper, so the byte measuring parses with the same limits as the request. */
    @org.springframework.beans.factory.annotation.Autowired
    public SyncRequestValidator(ObjectMapper reader) {
        this(reader, null);
    }

    /** For tests: reads the contract from {@code contract} (the classpath copy when null). */
    SyncRequestValidator(ObjectMapper reader, InputStream contract) {
        this.reader = reader;
        JsonNode components;
        try (InputStream in = contract != null ? contract : SyncRequestValidator.class.getResourceAsStream("/openapi.yaml")) {
            components = new YAMLMapper().readTree(in).path("components");
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("openapi.yaml cannot be read", e);
        }
        for (JsonNode name : components.path("schemas").path("SyncTable").path("enum")) {
            if (SyncTable.byName(name.asString()).isEmpty()) {
                unimplemented.add(name.asString());
            }
        }
        ObjectMapper json = new ObjectMapper();
        ObjectNode wrapper = json.createObjectNode();
        wrapper.put("$schema", DIALECT);
        wrapper.put("$ref", "#/components/schemas/SyncRequest");
        wrapper.set("components", components);
        this.requestSchema = SchemaRegistry.withDefaultDialect(REQUEST_DIALECT,
                b -> b.schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build())).getSchema(wrapper);
        for (SyncTable t : SyncTable.values()) {
            JsonNode schemas = components.path("schemas");
            fields.put(t, recordFields(schemas, schemas.path(schemaName(t))));
            Map<String, CompactJsonSizes.Limit> limits = byteLimits(schemas, schemas.path(schemaName(t)));
            if (!limits.isEmpty()) {
                byteLimits.put(t.name(), limits);
            }
        }
    }

    /** {@code raw} is the request body {@code body} was parsed from; the byte limits are measured on it. */
    public Parsed validate(String userId, JsonNode body, byte[] raw) {
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
        // A table in the contract that this backend does not store: refuse each record by its path, so the app sets
        // it aside like any other refused record, instead of dropping it unseen. Only the table name and index are
        // named, never the record. Pulls never return such a table (the service reads SyncTable.values() only).
        for (String table : unimplemented) {
            JsonNode list = body.path("changes").path(table);
            for (int i = 0; list.isArray() && i < list.size(); i++) {
                problems.add(new ErrorResponse.Detail("changes." + table + "[" + i + "]", "unsupported_table"));
            }
        }
        for (com.networknt.schema.Error m : requestSchema.validate(body)) {
            problems.add(detail(m));
        }
        if (!problems.isEmpty()) {
            throw invalid(problems);
        }

        // Measured on the raw bytes (number text as sent), and only once the shape is known to be valid.
        try {
            for (String path : CompactJsonSizes.overLimit(reader, raw, byteLimits)) {
                problems.add(new ErrorResponse.Detail(path, "max_json_bytes"));
            }
        } catch (RuntimeException e) {
            // Fail closed. The message may quote the body, so it is dropped.
            throw invalid(List.of(new ErrorResponse.Detail("", "type")));
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

    /** Fields of the record schema with {@code x-max-json-bytes}, on the field or (for an array) on its items. */
    private static Map<String, CompactJsonSizes.Limit> byteLimits(JsonNode schemas, JsonNode schema) {
        Map<String, JsonNode> props = new java.util.LinkedHashMap<>();
        collectProperties(schemas, schema, props);
        Map<String, CompactJsonSizes.Limit> out = new java.util.HashMap<>();
        props.forEach((name, prop) -> {
            if (prop.has(MAX_JSON_BYTES)) {
                out.put(name, new CompactJsonSizes.Limit(prop.get(MAX_JSON_BYTES).asLong(), false));
            } else if (prop.path("items").has(MAX_JSON_BYTES)) {
                out.put(name, new CompactJsonSizes.Limit(prop.path("items").get(MAX_JSON_BYTES).asLong(), true));
            }
        });
        return out;
    }

    private static void collectProperties(JsonNode schemas, JsonNode schema, Map<String, JsonNode> out) {
        if (schema.has("$ref")) {
            String ref = schema.get("$ref").asString();
            collectProperties(schemas, schemas.path(ref.substring(ref.lastIndexOf('/') + 1)), out);
        }
        schema.path("properties").properties().forEach(e -> out.put(e.getKey(), e.getValue()));
        for (JsonNode part : schema.path("allOf")) {
            collectProperties(schemas, part, out);
        }
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
