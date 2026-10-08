package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.foodLog;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.ValidationMessage;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Real responses against the schemas in packages/api/openapi.yaml: the envelope, every pulled record by its
 * table's schema, conflict server records by table, and the shared Error schema.
 */
class SyncContractIT extends SyncITBase {

    static final String OLD = "2026-10-08T10:00:00Z";
    static final String MID = "2026-10-08T11:00:00Z";
    static final String NEW = "2026-10-08T11:30:00Z";

    private void assertConforms(String schema, JsonNode value) {
        Set<ValidationMessage> problems = ContractSchemas.validate(schema, value);
        assertThat(problems).as(schema + " " + value).isEmpty();
    }

    private void assertSyncResponse(Resp r) {
        assertThat(r.status()).isEqualTo(200);
        assertConforms("SyncResponse", r.body());
        // The envelope's SyncChanges and SyncConflict.server_record are validated by their own table's schema,
        // since SyncRecord is an anyOf that several tables satisfy.
        r.body().path("changes").fields().forEachRemaining(e -> {
            SyncTable t = SyncTable.byName(e.getKey()).orElseThrow();
            e.getValue().forEach(rec -> assertConforms(ContractSchemas.schemaNameOf(t), rec));
        });
        r.body().path("conflicts").forEach(c -> {
            SyncTable t = SyncTable.byName(c.path("table").asText()).orElseThrow();
            assertConforms(ContractSchemas.schemaNameOf(t), c.path("server_record"));
        });
    }

    @Test
    void theBundledContractIsTheContract() throws Exception {
        byte[] bundled = SyncContractIT.class.getResourceAsStream("/openapi.yaml").readAllBytes();
        assertThat(bundled)
                .as("backend/src/main/resources/openapi.yaml must be an exact copy of packages/api/openapi.yaml; copy it again")
                .isEqualTo(Files.readAllBytes(ContractSchemas.CONTRACT));
    }

    @Test
    void syncTableEnumMatchesTheContract() {
        List<String> contract = new ArrayList<>();
        ContractSchemas.schema("SyncTable").path("enum").forEach(n -> contract.add(n.asText()));
        List<String> ours = new ArrayList<>();
        for (SyncTable t : SyncTable.values()) {
            ours.add(t.name());
        }
        assertThat(ours).isEqualTo(contract);
        for (SyncTable t : SyncTable.values()) {
            assertThat(ContractSchemas.schema(ContractSchemas.schemaNameOf(t)).isMissingNode()).as(t.name()).isFalse();
        }
    }

    @Test
    void ourFixturesAreValidRequestsPerTheContract() {
        String user = newUser();
        Req all = Req.of(null);
        SyncFixtures.oneOfEach(user, MID).forEach(all::add);
        assertConforms("SyncRequest", all.build());
    }

    @Test
    void theValidatorRejectsWhatTheContractRejects() {
        // Negative control: a schema check that cannot fail proves nothing.
        ObjectNode bad = Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 0)).build();
        assertThat(ContractSchemas.validate("SyncRequest", bad)).isNotEmpty();
    }

    @Test
    void responsesOfEveryKindConformIncludingEveryTablesRecords() {
        String user = newUser();
        Map<SyncTable, ObjectNode> all = SyncFixtures.oneOfEach(user, MID);

        // Push one record of every table, then pull them all as another device.
        Req push = Req.of(null);
        all.forEach(push::add);
        Resp pushed = post(user, push.build());
        assertSyncResponse(pushed);
        assertThat(pushed.body().path("applied")).hasSize(all.size());
        assertSyncResponse(post(user, Req.of(null).build()));

        // Conflicts on every table: a stale push with a different, older edit gives server_won with that table's record.
        Req stale = Req.of(null);
        all.forEach((t, rec) -> {
            ObjectNode edited = rec.deepCopy();
            edited.put("updated_at", OLD);
            changeSomething(t, edited);
            stale.add(t, edited);
        });
        Resp conflicted = post(user, stale.build());
        assertSyncResponse(conflicted);
        assertThat(conflicted.body().path("conflicts")).hasSize(all.size());
        assertThat(conflicted.body().path("conflicts").findValuesAsText("resolution")).containsOnly("server_won");

        // client_won, retry, tombstone, paging.
        String rid = id();
        post(user, Req.of(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Poha", 291)).build());
        assertSyncResponse(post(user, Req.of(null).add(SyncTable.food_logs, foodLog(rid, 0, NEW, null, "Upma", 250)).build()));
        assertSyncResponse(post(user, Req.of(null).add(SyncTable.food_logs, foodLog(rid, 0, NEW, null, "Upma", 250)).build()));
        assertSyncResponse(post(user, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, MID, 250)).build()));
        assertSyncResponse(post(user, Req.of("c_0000000000000000").build()));
    }

    @Test
    void pagedResponsesConform() {
        String user = newUser();
        Req big = Req.of(null);
        for (int i = 0; i < 500; i++) {
            big.add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250));
        }
        post(user, big.build());
        Req more = Req.of(null);
        for (int i = 0; i < 10; i++) {
            more.add(SyncTable.food_logs, foodLog(id(), 0, MID, null, "Poha", 291));
        }
        post(user, more.build());
        Resp page1 = post(user, Req.of(null).build());
        assertSyncResponse(page1);
        assertThat(page1.body().path("has_more").asBoolean()).isTrue();
        Resp page2 = post(user, Req.of(page1.body().path("cursor").asText()).build());
        assertSyncResponse(page2);
        assertThat(page2.body().path("has_more").asBoolean()).isFalse();
    }

    @Test
    void errorResponsesConformToTheErrorSchema() {
        String user = newUser();
        Resp invalid = post(jwtFor(user), "{\"cursor\":null}");
        assertThat(invalid.status()).isEqualTo(400);
        assertConforms("Error", invalid.body());
        assertThat(invalid.body().path("details")).isNotEmpty();

        Resp unauthorized = post((String) null, "{\"cursor\":null,\"changes\":{}}");
        assertThat(unauthorized.status()).isEqualTo(401);
        assertConforms("Error", unauthorized.body());

        Resp badRecord = post(user, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 0)).build());
        assertThat(badRecord.status()).isEqualTo(400);
        assertConforms("Error", badRecord.body());
    }

    private String jwtFor(String user) {
        return jwt.issue(user).value();
    }

    /** Edits one content field so the stale push is not mistaken for a retry. */
    private static void changeSomething(SyncTable t, ObjectNode rec) {
        switch (t) {
            case profiles -> rec.put("age", 31);
            case consents -> rec.put("text_version", "2026-11-01");
            case food_logs -> rec.put("name", "Edited");
            case water_logs -> rec.put("ml", 300);
            case day_notes -> rec.put("steps", 1);
            case workouts -> rec.put("cardio_min", 99);
            case workout_sets -> rec.put("reps", 99);
            case lift_stats -> rec.put("sessions", 99);
            case weights -> rec.put("weight_kg", 70);
            case measurements -> rec.put("waist_cm", 99);
            case user_foods -> rec.put("name", "Edited");
            case recipes -> rec.put("name", "Edited");
            case kitchen_tests -> rec.put("note", "Edited");
            case exclusions -> rec.put("done", true);
            case swaps -> rec.put("to", "Edited");
            case settings -> rec.put("rest_off", true);
        }
    }
}
