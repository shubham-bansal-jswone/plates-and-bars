package app.plateandbar.api.ai;

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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Validates AI bodies against the schemas in the contract (the one {@code openapi.yaml} on the classpath). */
@Component
class AiSchemas {

    private final JsonNode components;
    private final SchemaValidatorsConfig config =
            SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build();

    AiSchemas() {
        try (InputStream in = AiSchemas.class.getResourceAsStream("/openapi.yaml")) {
            this.components = new YAMLMapper().readTree(in).path("components");
        } catch (IOException e) {
            throw new IllegalStateException("openapi.yaml cannot be read", e);
        }
    }

    private final java.util.Map<String, JsonSchema> cache = new java.util.concurrent.ConcurrentHashMap<>();

    private JsonSchema schema(String name) {
        return cache.computeIfAbsent(name, n -> {
            ObjectNode wrapper = new ObjectMapper().createObjectNode();
            wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
            wrapper.put("$ref", "#/components/schemas/" + n);
            wrapper.set("components", components);
            return JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(wrapper, config);
        });
    }

    /** Problems as (field, keyword) pairs; never the submitted value. Empty when valid. */
    List<ErrorResponse.Detail> problems(String schemaName, JsonNode body) {
        Set<ErrorResponse.Detail> out = new LinkedHashSet<>();
        for (ValidationMessage m : schema(schemaName).validate(body)) {
            StringBuilder path = new StringBuilder();
            for (String part : m.getInstanceLocation().toString().split("/")) {
                append(path, part);
            }
            append(path, m.getProperty());
            out.add(new ErrorResponse.Detail(path.toString(), m.getType()));
        }
        return List.copyOf(out);
    }

    /** 400 {@code invalid_request} unless the request body fits the named request schema. */
    void requireValid(String schemaName, JsonNode body) {
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
