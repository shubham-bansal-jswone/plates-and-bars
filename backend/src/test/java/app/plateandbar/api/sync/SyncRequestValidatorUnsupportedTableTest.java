package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * A contract table the backend does not implement must be refused per record, never silently dropped. The real
 * contract is used with a made-up extra table, so this holds whatever tables the contract gains or the backend adds.
 */
class SyncRequestValidatorUnsupportedTableTest {

    private static final String USER = "6f1c2a3e-1b2c-4d5e-8f90-1234567890ab";
    private static final String AT = "2026-10-08T09:00:00Z";
    private static final String FUTURE = "zz_future_table";

    private static SyncRequestValidator validatorWithFutureTable() throws Exception {
        YAMLMapper yaml = new YAMLMapper();
        ObjectNode doc = (ObjectNode) yaml.readTree(java.nio.file.Files.readAllBytes(ContractSchemas.CONTRACT));
        ObjectNode schemas = (ObjectNode) doc.path("components").path("schemas");
        ((ArrayNode) schemas.path("SyncTable").path("enum")).add(FUTURE);
        ObjectNode items = new ObjectMapper().createObjectNode().put("type", "object");
        ((ObjectNode) schemas.path("SyncChanges").path("properties")).set(FUTURE,
                new ObjectMapper().createObjectNode().put("type", "array").set("items", items));
        return new SyncRequestValidator(new ObjectMapper(), new ByteArrayInputStream(yaml.writeValueAsBytes(doc)));
    }

    private static ApiException refuse(SyncRequestValidator v, ObjectNode body) {
        return catchThrowableOfType(ApiException.class,
                () -> v.validate(USER, body, body.toString().getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void everyRecordOfAnUnimplementedTableIsRefusedByItsPathWithNoContent() throws Exception {
        ObjectNode body = Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, AT, null, 250)).build();
        ArrayNode future = ((ObjectNode) body.path("changes")).putArray(FUTURE);
        future.addObject().put("id", id()).put("note", "My Secret Lift");
        future.addObject().put("id", id());

        ApiException e = refuse(validatorWithFutureTable(), body);

        assertThat(e).isNotNull();
        assertThat(e.status().value()).isEqualTo(400);
        assertThat(e.details()).containsExactly(
                new ErrorResponse.Detail("changes." + FUTURE + "[0]", "unsupported_table"),
                new ErrorResponse.Detail("changes." + FUTURE + "[1]", "unsupported_table"));
        assertThat(e.details().toString()).doesNotContain("My Secret Lift");
    }

    @Test
    void anEmptyListForAnUnimplementedTableIsHarmless() throws Exception {
        ObjectNode body = Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, AT, null, 250)).build();
        ((ObjectNode) body.path("changes")).putArray(FUTURE);
        assertThat(refuse(validatorWithFutureTable(), body)).isNull();
    }

    @Test
    void aPushWithoutTheTableIsNotAffected() throws Exception {
        ObjectNode body = Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, AT, null, 250)).build();
        assertThat(refuse(validatorWithFutureTable(), body)).isNull();
        assertThat(refuse(new SyncRequestValidator(), body)).isNull();
    }
}
