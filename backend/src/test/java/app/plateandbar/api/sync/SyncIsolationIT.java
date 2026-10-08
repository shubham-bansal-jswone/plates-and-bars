package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.naturalId;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** One user can never read, overwrite, delete or learn about another user's records, even knowing their ids. */
class SyncIsolationIT extends SyncITBase {

    static final String MID = "2026-10-08T11:00:00Z";
    static final String NEW = "2026-10-08T11:30:00Z";

    @Test
    void aUserNeverPullsAnotherUsersRecordsInAnyTable() {
        String a = newUser();
        String b = newUser();
        Req push = Req.of(null);
        SyncFixtures.oneOfEach(a, MID).forEach(push::add);
        ok(a, push.build());
        // A tombstone too.
        ok(a, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, MID, 250)).build());

        assertThat(ok(a, Req.of(null).build()).body().path("changes").size()).isEqualTo(SyncTable.values().length);

        for (String cursor : new String[] {null, "c_0000000000000000"}) {
            Resp b1 = ok(b, Req.of(cursor).build());
            assertThat(b1.body().path("changes")).as("B sees nothing of A's").isEmpty();
            assertThat(b1.body().path("applied")).isEmpty();
            assertThat(b1.body().path("conflicts")).isEmpty();
        }
    }

    @Test
    void guessingAnotherUsersRecordIdCreatesBsOwnRecordAndNeverTouchesAs() {
        String a = newUser();
        String b = newUser();
        String rid = id();
        ok(a, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 250)).build());

        // B pushes the same id, once as new and once claiming A's current version, with a much newer time.
        for (int version : new int[] {0, 1}) {
            String other = newUser();
            Resp r = ok(other, Req.of(null).add(SyncTable.water_logs, waterLog(rid, version, NEW, null, 999)).build());
            assertThat(r.body().path("conflicts")).as("no conflict with someone else's record").isEmpty();
            assertThat(r.body().path("applied").get(0).path("version").asInt()).isEqualTo(1);
        }
        Resp rb = ok(b, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 1, NEW, MID, 999)).build()); // B "deletes" it
        assertThat(rb.body().path("applied")).hasSize(1);

        // A's record is exactly as A left it.
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT version, deleted_at, JSON_EXTRACT(data, '$.ml') AS ml FROM water_logs WHERE user_id = ? AND id = ?", a, rid);
        assertThat(row.get("version")).isEqualTo(1);
        assertThat(row.get("deleted_at")).isNull();
        assertThat(row.get("ml").toString()).isEqualTo("250");
        JsonNode pull = ok(a, Req.of(null).build()).body().path("changes").path("water_logs");
        assertThat(pull).hasSize(1);
        assertThat(pull.get(0).path("ml").asInt()).isEqualTo(250);
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", a)).isZero();
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE id = ?", rid)).isEqualTo(4); // A, B and two others
    }

    @Test
    void aStaleEditByBOfAnIdOnlyAHasNeverProducesAConflictThatLeaksAsRecord() {
        String a = newUser();
        String b = newUser();
        String rid = id();
        ok(a, Req.of(null).add(SyncTable.food_logs, SyncFixtures.foodLog(rid, 0, NEW, null, "A-PRIVATE-MEAL", 500)).build());
        Resp r = ok(b, Req.of(null).add(SyncTable.food_logs, SyncFixtures.foodLog(rid, 0, MID, null, "B meal", 100)).build());
        assertThat(r.body().toString()).doesNotContain("A-PRIVATE-MEAL");
        assertThat(r.body().path("conflicts")).isEmpty();
    }

    @Test
    void naturalKeyIdsAreDerivedFromTheCallerSoAnotherUsersIdIsRefused() {
        String a = newUser();
        String b = newUser();
        ObjectNode aProfile = SyncFixtures.oneOfEach(a, MID).get(SyncTable.profiles);
        ok(a, Req.of(null).add(SyncTable.profiles, aProfile).build());

        // B sends A's profile (same id) as its own.
        Resp r = post(b, Req.of(null).add(SyncTable.profiles, aProfile).build());
        assertThat(r.status()).isEqualTo(400);
        assertThat(r.body().path("details").get(0).path("field").asText()).isEqualTo("changes.profiles[0].id");
        assertThat(r.body().toString()).doesNotContain("recomp");

        // And B's own profile has a different id.
        assertThat(naturalId(a, "profiles", "me")).isNotEqualTo(naturalId(b, "profiles", "me"));
        ok(b, Req.of(null).add(SyncTable.profiles, SyncFixtures.oneOfEach(b, MID).get(SyncTable.profiles)).build());
        assertThat(count("SELECT COUNT(*) FROM profiles WHERE user_id = ?", a)).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM profiles WHERE user_id = ?", b)).isEqualTo(1);
    }

    @Test
    void aUserIdInThePayloadIsIgnored() {
        String a = newUser();
        String b = newUser();
        ObjectNode rec = waterLog(id(), 0, MID, null, 250);
        rec.put("user_id", a);
        ObjectNode req = Req.of(null).add(SyncTable.water_logs, rec).build();
        req.put("user_id", a);
        ok(b, req);

        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", a)).isZero();
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", b)).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE JSON_CONTAINS_PATH(data, 'one', '$.user_id')")).isZero();
    }

    @Test
    void changeNumbersAndCursorsAreEachUsersOwn() {
        String a = newUser();
        String b = newUser();
        Req many = Req.of(null);
        for (int i = 0; i < 20; i++) {
            many.add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250));
        }
        String aCursor = ok(a, many.build()).body().path("cursor").asText();
        assertThat(aCursor).isNotEqualTo("c_0000000000000000");

        // A's cursor is ahead of anything B has done, so it is not valid for B and gives B no view of A.
        assertThat(post(b, Req.of(aCursor).build()).status()).isEqualTo(400);
    }

    @Test
    void conflictLogsBelongToTheUserWhoseRecordConflicted() {
        String a = newUser();
        String b = newUser();
        String rid = id();
        for (String u : List.of(a, b)) {
            ok(u, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 0, NEW, null, 250)).build());
            ok(u, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 300)).build());
        }
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", a)).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", b)).isEqualTo(1);
    }

    @Test
    void deletingAUserRemovesTheirSyncDataAndOnlyTheirs() {
        String a = newUser();
        String b = newUser();
        Req push = Req.of(null);
        SyncFixtures.oneOfEach(a, MID).forEach(push::add);
        ok(a, push.build());
        ok(b, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250)).build());
        ok(a, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, NEW, null, 1)).build());

        jdbc.update("DELETE FROM users WHERE id = ?", a);

        for (SyncTable t : SyncTable.values()) {
            assertThat(count("SELECT COUNT(*) FROM " + t.sqlName() + " WHERE user_id = ?", a)).as(t.name()).isZero();
        }
        assertThat(count("SELECT COUNT(*) FROM sync_state WHERE user_id = ?", a)).isZero();
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", b)).isEqualTo(1);
    }
}
