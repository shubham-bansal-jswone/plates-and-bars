package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.foodLog;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Real responses against the schemas in packages/api/openapi.yaml: the envelope, every pulled record by its
 * table's schema, conflict server records by table, and the shared Error schema.
 */
class SyncContractIT extends SyncITBase {

    static final String OLD = "2026-10-08T10:00:00Z";
    static final String MID = "2026-10-08T11:00:00Z";
    static final String NEW = "2026-10-08T11:30:00Z";

    private void assertConforms(String schema, JsonNode value) {
        List<com.networknt.schema.Error> problems = ContractSchemas.validate(schema, value);
        assertThat(problems).as(schema + " " + value).isEmpty();
    }

    private void assertSyncResponse(Resp r) {
        assertThat(r.status()).isEqualTo(200);
        assertConforms("SyncResponse", r.body());
        ContractSchemas.assertResponse("POST /sync", 200, r.body().toString());
        // The envelope's SyncChanges and SyncConflict.server_record are validated by their own table's schema,
        // since SyncRecord is an anyOf that several tables satisfy.
        r.body().path("changes").properties().forEach(e -> {
            SyncTable t = SyncTable.byName(e.getKey()).orElseThrow();
            e.getValue().forEach(rec -> assertConforms(ContractSchemas.schemaNameOf(t), rec));
        });
        r.body().path("conflicts").forEach(c -> {
            SyncTable t = SyncTable.byName(c.path("table").asString()).orElseThrow();
            assertConforms(ContractSchemas.schemaNameOf(t), c.path("server_record"));
            if (c.has("replaced_record")) {
                assertConforms(ContractSchemas.schemaNameOf(t), c.path("replaced_record"));
            }
        });
    }

    @Autowired SyncRepository repo;

    /** The losing copies the user's conflict log keeps, in the contract's record shape, oldest first. */
    private List<ObjectNode> loggedServerCopies(String user) {
        List<ObjectNode> out = new ArrayList<>();
        for (SyncRepository.Conflict c : repo.conflictsPage(user, 0, 1000)) {
            if (c.loser().equals("server")) {
                out.add(SyncService.toRecord(json, c.losing()));
            }
        }
        return out;
    }

    private JsonNode pulled(String user, SyncTable t, String id) {
        for (JsonNode r : post(user, Req.of(null).build()).body().path("changes").path(t.name())) {
            if (r.path("id").asString().equals(id)) {
                return r;
            }
        }
        throw new AssertionError("not pulled: " + id);
    }

    @Test
    void replacedRecordOnClientWonConformsPerTableAndIsTheLoggedCopy() {
        String user = newUser();
        Map<SyncTable, ObjectNode> all = SyncFixtures.oneOfEach(user, MID);
        Req push = Req.of(null);
        all.forEach(push::add);
        ok(user, push.build());
        Map<SyncTable, JsonNode> stored = new java.util.EnumMap<>(SyncTable.class);
        all.forEach((t, rec) -> stored.put(t, pulled(user, t, rec.path("id").asString())));

        Req newer = Req.of(null);
        all.forEach((t, rec) -> {
            ObjectNode edited = rec.deepCopy();
            edited.put("updated_at", NEW);
            changeSomething(t, edited);
            newer.add(t, edited);
        });
        Resp r = post(user, newer.build());
        assertSyncResponse(r);
        assertThat(r.body().path("conflicts")).hasSize(all.size());

        List<ObjectNode> log = loggedServerCopies(user);
        assertThat(log).hasSize(all.size());
        for (JsonNode c : r.body().path("conflicts")) {
            SyncTable t = SyncTable.byName(c.path("table").asString()).orElseThrow();
            assertThat(c.path("resolution").asString()).isEqualTo("client_won");
            JsonNode replaced = c.path("replaced_record");
            assertThat(replaced.isObject()).as(t.name()).isTrue();
            assertConforms(ContractSchemas.schemaNameOf(t), replaced);
            assertThat(replaced.path("version").asInt()).as(t.name()).isEqualTo(c.path("server_version").asInt() - 1);
            assertThat(replaced).as(t.name() + " is the copy the device had pulled").isEqualTo(stored.get(t));
            assertThat(log).as(t.name() + " is the logged copy").contains((ObjectNode) replaced);
            assertThat(c.path("server_record").path("updated_at").asString()).isEqualTo(NEW);
        }
    }

    @Test
    void replacedRecordIsAbsentOnServerWonAndOnTheRetryOfALostClientWonAnswer() {
        String user = newUser();
        String rid = id();
        ok(user, Req.of(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Poha", 291)).build());

        // server_won: an older edit loses; the losing copy is the device's own, logged as loser client.
        Resp lost = ok(user, Req.of(null).add(SyncTable.food_logs, foodLog(rid, 0, OLD, null, "Old", 1)).build());
        assertThat(lost.body().path("conflicts").get(0).path("resolution").asString()).isEqualTo("server_won");
        assertThat(lost.body().path("conflicts").get(0).has("replaced_record")).isFalse();
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isEqualTo(1);
        assertThat(loggedServerCopies(user)).isEmpty();

        // client_won, then the same push again because the answer was lost: idempotent server_won, nothing new logged.
        ObjectNode edit = foodLog(rid, 0, NEW, null, "Upma", 250);
        Resp won = ok(user, Req.of(null).add(SyncTable.food_logs, edit).build());
        assertThat(won.body().path("conflicts").get(0).path("resolution").asString()).isEqualTo("client_won");
        assertThat(won.body().path("conflicts").get(0).has("replaced_record")).isTrue();
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isEqualTo(2);

        Resp retry = ok(user, Req.of(null).add(SyncTable.food_logs, edit).build());
        JsonNode c = retry.body().path("conflicts").get(0);
        assertThat(c.path("resolution").asString()).isEqualTo("server_won");
        assertThat(c.has("replaced_record")).isFalse();
        assertThat(c.path("server_version").asInt()).isEqualTo(2);
        assertSyncResponse(retry);
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isEqualTo(2);
    }

    @Test
    void replacedRecordKeepsTombstonesOnEitherSide() {
        String user = newUser();

        // The server's copy is a tombstone and the device's newer edit revives it.
        String dead = id();
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(dead, 0, MID, MID, 250)).build());
        Resp revived = ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(dead, 0, NEW, null, 300)).build());
        JsonNode c1 = revived.body().path("conflicts").get(0);
        assertSyncResponse(revived);
        assertThat(c1.path("resolution").asString()).isEqualTo("client_won");
        assertThat(c1.path("replaced_record").path("deleted_at").asString()).isEqualTo(MID);
        assertThat(c1.path("replaced_record").path("version").asInt()).isEqualTo(1);
        assertThat(c1.path("server_record").path("deleted_at").isNull()).isTrue();

        // The device's newer edit is a tombstone and replaces a live copy.
        String live = id();
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(live, 0, MID, null, 250)).build());
        Resp deleted = ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(live, 0, NEW, NEW, 250)).build());
        JsonNode c2 = deleted.body().path("conflicts").get(0);
        assertSyncResponse(deleted);
        assertThat(c2.path("resolution").asString()).isEqualTo("client_won");
        assertThat(c2.path("replaced_record").path("deleted_at").isNull()).isTrue();
        assertThat(c2.path("replaced_record").path("ml").asInt()).isEqualTo(250);
        assertThat(c2.path("server_record").path("deleted_at").asString()).isEqualTo(NEW);

        List<ObjectNode> log = loggedServerCopies(user);
        assertThat(log).containsExactly((ObjectNode) c1.path("replaced_record"), (ObjectNode) c2.path("replaced_record"));
    }

    @Test
    void recordsNearTheSizeLimitsComeBackUnchangedAsTheReplacedRecord() {
        String user = newUser();
        // A food name at its 200-character limit (multi-byte) and settings.adjustments at exactly 64 KiB.
        String fid = id();
        ObjectNode bigFood = foodLog(fid, 0, MID, null, "\u00e9".repeat(200), 291);
        ObjectNode settings = SyncFixtures.oneOfEach(user, MID).get(SyncTable.settings);
        settings.set("adjustments", SyncFixtures.obj("{'k':'" + "x".repeat(65536 - 8) + "'}"));
        ok(user, Req.of(null).add(SyncTable.food_logs, bigFood).add(SyncTable.settings, settings).build());
        JsonNode storedFood = pulled(user, SyncTable.food_logs, fid);
        JsonNode storedSettings = pulled(user, SyncTable.settings, settings.path("id").asString());

        ObjectNode food2 = foodLog(fid, 0, NEW, null, "small", 1);
        ObjectNode settings2 = SyncFixtures.oneOfEach(user, NEW).get(SyncTable.settings);
        Resp r = ok(user, Req.of(null).add(SyncTable.food_logs, food2).add(SyncTable.settings, settings2).build());
        assertSyncResponse(r);
        assertThat(r.body().path("conflicts")).hasSize(2);
        for (JsonNode c : r.body().path("conflicts")) {
            JsonNode want = c.path("table").asString().equals("food_logs") ? storedFood : storedSettings;
            assertThat(c.path("replaced_record")).isEqualTo(want);
        }
        assertThat(storedFood.path("name").asString()).hasSize(200);
        assertThat(loggedServerCopies(user)).containsExactlyInAnyOrder((ObjectNode) storedFood, (ObjectNode) storedSettings);
    }

    /**
     * Contract tables the backend has not implemented yet, each tied to the issue that will. A contract table that is
     * neither a {@link SyncTable} nor listed here fails the build; the validator refuses pushes for these per record
     * (SyncRequestValidatorUnsupportedTableTest). Remove the entry in the PR that adds the table.
     */
    private static final Map<String, String> NOT_YET_IMPLEMENTED = Map.of("routines", "#1184");

    @Test
    void syncTableEnumMatchesTheContract() {
        List<String> contract = new ArrayList<>();
        ContractSchemas.schema("SyncTable").path("enum").forEach(n -> contract.add(n.asString()));
        for (SyncTable t : SyncTable.values()) {
            assertThat(contract).as("backend table %s is in the contract", t.name()).contains(t.name());
            assertThat(ContractSchemas.schema(ContractSchemas.schemaNameOf(t)).isMissingNode()).as(t.name()).isFalse();
        }
        List<String> ours = new ArrayList<>();
        for (SyncTable t : SyncTable.values()) {
            ours.add(t.name());
        }
        List<String> unimplemented = contract.stream().filter(c -> !ours.contains(c)).toList();
        assertThat(unimplemented).as("contract tables the backend does not implement must be allowlisted with an issue")
                .allMatch(NOT_YET_IMPLEMENTED::containsKey);
        // An entry for a table the backend now implements is stale. (One the contract does not have yet is fine: the
        // allowlist must pass both before and after the contract PR that adds the table.)
        assertThat(NOT_YET_IMPLEMENTED.keySet()).as("stale allowlist entries").noneMatch(ours::contains);
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
        assertThat(conflicted.body().path("conflicts").findValuesAsString("resolution")).containsOnly("server_won");

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
        Resp page2 = post(user, Req.of(page1.body().path("cursor").asString()).build());
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
