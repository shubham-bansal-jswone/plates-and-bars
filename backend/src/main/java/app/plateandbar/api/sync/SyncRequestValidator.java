package app.plateandbar.api.sync;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
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
 * Validates a {@code POST /sync} body against the schemas in the contract (a copy of
 * {@code packages/api/openapi.yaml} on the classpath; a test fails if it drifts from the original), then
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

    private final JsonSchema requestSchema;
    private final Map<SyncTable, Set<String>> fields = new java.util.EnumMap<>(SyncTable.class);

    public SyncRequestValidator() {
        JsonNode components;
        try (InputStream in = SyncRequestValidator.class.getResourceAsStream("/openapi.yaml")) {
            components = new YAMLMapper().readTree(in).path("components");
        } catch (IOException e) {
            throw new IllegalStateException("openapi.yaml cannot be read", e);
        }
        ObjectMapper json = new ObjectMapper();
        ObjectNode wrapper = json.createObjectNode();
        wrapper.put("$schema", DIALECT);
        wrapper.put("$ref", "#/components/schemas/SyncRequest");
        wrapper.set("components", components);
        SchemaValidatorsConfig config =
                SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build();
        this.requestSchema = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(wrapper, config);
        for (SyncTable t : SyncTable.values()) {
            fields.put(t, recordFields(components.path("schemas"), components.path("schemas").path(schemaName(t))));
        }
    }

    public Parsed validate(String userId, JsonNode body) {
        if (body == null || !body.isObject()) {
            throw invalid(List.of(new ErrorResponse.Detail("", "type")));
        }
        List<ErrorResponse.Detail> problems = new ArrayList<>();
        for (ValidationMessage m : requestSchema.validate(body)) {
            problems.add(detail(m));
        }
        if (!problems.isEmpty()) {
            throw invalid(problems);
        }

        String cursor = body.path("cursor").isNull() ? null : body.path("cursor").asText();
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
        String id = rec.path("id").asText().toLowerCase(java.util.Locale.ROOT);
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
            return OffsetDateTime.parse(node.asText()).toInstant();
        } catch (DateTimeParseException e) {
            throw invalid(List.of(new ErrorResponse.Detail(path, "format")));
        }
    }

    private static ErrorResponse.Detail detail(ValidationMessage m) {
        StringBuilder path = new StringBuilder();
        // The validator reports a JSON pointer such as /changes/food_logs/0/meal; the contract wants a path.
        for (String part : m.getInstanceLocation().toString().split("/")) {
            appendSegment(path, part);
        }
        appendSegment(path, m.getProperty());
        return new ErrorResponse.Detail(path.toString(), m.getType());
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
            String ref = schema.get("$ref").asText();
            collect(schemas, schemas.path(ref.substring(ref.lastIndexOf('/') + 1)), names);
        }
        schema.path("properties").fieldNames().forEachRemaining(names::add);
        for (JsonNode part : schema.path("allOf")) {
            collect(schemas, part, names);
        }
    }
}
