package app.plateandbar.api.ai;

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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Validates AI bodies against the schemas in the contract (the one {@code openapi.yaml} on the classpath). */
@Component
class AiSchemas {

    private final JsonNode components;
    private final SchemaRegistry registry =
            SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
                    b -> b.schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()));

    AiSchemas() {
        try (InputStream in = AiSchemas.class.getResourceAsStream("/openapi.yaml")) {
            this.components = new YAMLMapper().readTree(in).path("components");
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("openapi.yaml cannot be read", e);
        }
    }

    /** The Muscle enum from the contract, in contract order. */
    List<String> muscles() {
        return enumValues(components.path("schemas").path("Muscle"));
    }

    /** The equipment enum of SuggestTagsResponse, in contract order. */
    List<String> equipment() {
        return enumValues(components.path("schemas").path("SuggestTagsResponse").path("properties").path("equipment"));
    }

    private static List<String> enumValues(JsonNode node) {
        List<String> out = new java.util.ArrayList<>();
        node.path("enum").forEach(v -> out.add(v.asString()));
        if (out.isEmpty()) {
            throw new IllegalStateException("enum missing in openapi.yaml");
        }
        return List.copyOf(out);
    }

    private final java.util.Map<String, Schema> cache = new java.util.concurrent.ConcurrentHashMap<>();

    private Schema schema(String name) {
        return cache.computeIfAbsent(name, n -> {
            ObjectNode wrapper = new ObjectMapper().createObjectNode();
            wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
            wrapper.put("$ref", "#/components/schemas/" + n);
            wrapper.set("components", components);
            return registry.getSchema(wrapper);
        });
    }

    /** Problems as (field, keyword) pairs; never the submitted value. Empty when valid. */
    List<ErrorResponse.Detail> problems(String schemaName, JsonNode body) {
        Set<ErrorResponse.Detail> out = new LinkedHashSet<>();
        for (com.networknt.schema.Error m : schema(schemaName).validate(body)) {
            StringBuilder path = new StringBuilder();
            for (String part : m.getInstanceLocation().toString().split("/")) {
                append(path, part);
            }
            if (!"additionalProperties".equals(m.getKeyword())) {
                append(path, m.getProperty()); // for additionalProperties it is the submitted key: never echo it
            }
            out.add(new ErrorResponse.Detail(path.toString(), m.getKeyword()));
        }
        return List.copyOf(out);
    }

    /** Stands in for a body over 16 KB (16,384 bytes) that was not read; compared by identity. */
    static final JsonNode TOO_LARGE = tools.jackson.databind.node.StringNode.valueOf("too_large");

    /** 400 {@code invalid_request} unless the request body fits the named request schema. */
    void requireValid(String schemaName, JsonNode body) {
        if (body == TOO_LARGE) {
            throw invalid(List.of(new ErrorResponse.Detail("", "too_large")));
        }
        List<ErrorResponse.Detail> p = body == null || !body.isObject()
                ? List.of(new ErrorResponse.Detail("", "type"))
                : problems(schemaName, body);
        if (!p.isEmpty()) {
            throw invalid(p.size() > 20 ? p.subList(0, 20) : p);
        }
    }

    static ApiException invalid(List<ErrorResponse.Detail> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "The request is not valid.", details);
    }

    private static void append(StringBuilder path, String segment) {
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
}
