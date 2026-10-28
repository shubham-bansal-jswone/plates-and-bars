package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.routine;
import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.context.TestPropertySource;

/**
 * The routines table (#1184, ADR 011) on real MySQL: ordinary sync rules (versions, newer edit wins, conflict log,
 * tombstones, retries, isolation) and the 100-live-routine cap, driven by the contract's cap vectors. The account
 * record cap is on (at 150) so the order of the two caps is tested too.
 */
@TestPropertySource(properties = "app.sync.max-records-per-account=150")
class SyncRoutinesIT extends SyncITBase {

    static final String OLD = "2026-10-01T06:00:00Z";
    static final String MID = "2026-10-08T11:00:00Z";
    static final String LATER = "2026-10-08T11:30:00Z";
    static final String EARLIER = "2026-10-08T10:00:00Z";

    private static JsonNode only(JsonNode array) {
        assertThat(array).hasSize(1);
        return array.get(0);
    }

    private JsonNode pulled(Resp r, String rid) {
        for (JsonNode n : r.body().path("changes").path("routines")) {
            if (n.path("id").asString().equals(rid)) {
                return n;
            }
        }
        return null;
    }

    private int live(String user) {
        return count("SELECT COUNT(*) FROM routines WHERE user_id = ? AND deleted_at IS NULL", user);
    }

    // ---- ordinary sync rules ----

    @Test
    void aRoutineIsStoredAtVersion1AndAnotherDevicePullsItWithAllItsFields() {
        String user = newUser();
        String rid = id();
        Resp push = ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "Upper A")).build());
        assertThat(only(push.body().path("applied")).path("table").asString()).isEqualTo("routines");
        assertThat(only(push.body().path("applied")).path("version").asInt()).isEqualTo(1);
        ContractSchemas.assertResponse("POST /sync", 200, push.body().toString());

        Resp pull = ok(user, Req.of(null).build());
        JsonNode rec = pulled(pull, rid);
        assertThat(rec.path("name").asString()).isEqualTo("Upper A");
        assertThat(rec.path("exercises")).hasSize(2);
        assertThat(rec.path("created_at").asString()).isEqualTo("2026-10-08T06:00:00Z");
        assertThat(ContractSchemas.validate("Routine", rec)).isEmpty();
    }

    @Test
    void unknownExerciseKeysSurviveTheRoundTrip() {
        String user = newUser();
        String rid = id();
        var r = routine(rid, 0, MID, null, "Push");
        ((tools.jackson.databind.node.ObjectNode) r.path("exercises").get(0)).put("group", "a");
        ok(user, Req.of(null).add(SyncTable.routines, r).build());
        JsonNode rec = pulled(ok(user, Req.of(null).build()), rid);
        assertThat(rec.path("exercises").get(0).path("group").asString()).isEqualTo("a");
    }

    @Test
    void anEditAtTheStoredVersionBumpsIt() {
        String user = newUser();
        String rid = id();
        ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "A")).build());
        Resp edit = ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 1, LATER, null, "B")).build());
        assertThat(only(edit.body().path("applied")).path("version").asInt()).isEqualTo(2);
        assertThat(edit.body().path("conflicts")).isEmpty();
        assertThat(pulled(ok(user, Req.of(null).build()), rid).path("name").asString()).isEqualTo("B");
    }

    @Test
    void theNewerEditWinsAndTheLoserGoesToTheConflictLog() {
        String user = newUser();
        String rid = id();
        ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "Server copy")).build());
        // A device that last saw version 1 edits later than the stored copy while another edit made version 2.
        ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 1, MID, null, "Second")).build());

        Resp newer = ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 1, LATER, null, "Newest")).build());
        JsonNode c = only(newer.body().path("conflicts"));
        assertThat(c.path("table").asString()).isEqualTo("routines");
        assertThat(c.path("resolution").asString()).isEqualTo("client_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ? AND table_name = 'routines'", user)).isEqualTo(1);

        Resp older = ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 1, EARLIER, null, "Stale")).build());
        assertThat(only(older.body().path("conflicts")).path("resolution").asString()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ? AND table_name = 'routines'", user)).isEqualTo(2);
        String stored = jdbc.queryForObject(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) FROM routines WHERE user_id = ? AND id = ?", String.class, user, rid);
        assertThat(stored).isEqualTo("Newest");
    }

    @Test
    void aRetryOfASuccessfulPushIsIdempotent() {
        String user = newUser();
        String rid = id();
        var body = Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "A")).build();
        ok(user, body);
        Resp again = ok(user, body); // the response was lost; same bytes again
        assertThat(count("SELECT COUNT(*) FROM routines WHERE user_id = ?", user)).isEqualTo(1);
        assertThat(count("SELECT version FROM routines WHERE user_id = ? AND id = ?", user, rid)).isEqualTo(1);
        assertThat(only(again.body().path("conflicts")).path("resolution").asString()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    @Test
    void aDeleteIsATombstoneThatReachesOtherDevicesAndStaysStored() {
        String user = newUser();
        String rid = id();
        Resp first = ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "A")).build());
        String cursor = first.body().path("cursor").asString();
        ok(user, Req.of(cursor).add(SyncTable.routines, routine(rid, 1, LATER, LATER, "A")).build());

        JsonNode rec = pulled(ok(user, Req.of(cursor).build()), rid);
        assertThat(rec.path("deleted_at").isNull()).isFalse();
        assertThat(count("SELECT COUNT(*) FROM routines WHERE user_id = ? AND id = ?", user, rid)).isEqualTo(1);
        assertThat(live(user)).isZero();
        assertThat(count("SELECT records FROM sync_state WHERE user_id = ?", user)).isEqualTo(1); // tombstones count there
    }

    @Test
    void aTombstoneBeatsAnOlderEditAndTheEditIsLogged() {
        String user = newUser();
        String rid = id();
        ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "A")).build());
        ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 1, LATER, LATER, "A")).build());
        Resp stale = ok(user, Req.of(null).add(SyncTable.routines, routine(rid, 1, EARLIER, null, "Revived?")).build());
        assertThat(only(stale.body().path("conflicts")).path("resolution").asString()).isEqualTo("server_won");
        assertThat(live(user)).isZero();
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ? AND record_id = ?", user, rid)).isEqualTo(1);
    }

    @Test
    void oneUserNeverReadsOrChangesAnothersRoutines() {
        String a = newUser();
        String b = newUser();
        String rid = id();
        ok(a, Req.of(null).add(SyncTable.routines, routine(rid, 0, MID, null, "A's")).build());

        assertThat(pulled(ok(b, Req.of(null).build()), rid)).isNull();
        // B pushes the same id: it is a new record of B's, never an edit or a delete of A's.
        Resp push = ok(b, Req.of(null).add(SyncTable.routines, routine(rid, 1, LATER, LATER, "B's")).build());
        assertThat(only(push.body().path("applied")).path("version").asInt()).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM routines WHERE user_id = ? AND id = ? AND deleted_at IS NULL", a, rid)).isEqualTo(1);
        assertThat(pulled(ok(a, Req.of(null).build()), rid).path("name").asString()).isEqualTo("A's");
        assertThat(live(a)).isEqualTo(1);
        assertThat(live(b)).isZero();
    }

    // ---- the 100-live-routine cap, from the contract vectors ----

    private void seedRoutines(String user, List<String> live, List<String> tombstones, int tombVersion, String tombUpdated) {
        List<Object[]> rows = new ArrayList<>();
        for (String rid : live) {
            rows.add(new Object[] {user, rid, 1, "2026-10-01 06:00:00.000", null, 0,
                    "{\"name\":\"R\",\"exercises\":[{\"name\":\"Squat\",\"sets\":3}],\"created_at\":\"2026-10-01T06:00:00Z\"}"});
        }
        for (String rid : tombstones) {
            rows.add(new Object[] {user, rid, tombVersion, tombUpdated, "2026-10-02 06:00:00.000", 0,
                    "{\"name\":\"R\",\"exercises\":[{\"name\":\"Squat\",\"sets\":3}],\"created_at\":\"2026-10-01T06:00:00Z\"}"});
        }
        jdbc.batchUpdate("INSERT INTO routines (user_id, id, version, updated_at, deleted_at, seq, data)"
                + " VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))", rows);
    }

    private static List<String> ids(int n) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            out.add(UUID.randomUUID().toString());
        }
        return out;
    }

    static Stream<Arguments> capCases() {
        return RoutineVectors.FILE.path("cap").path("cases").valueStream().map(c -> Arguments.of(c.path("note").asString(), c));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("capCases")
    void capVectors(String note, JsonNode c) {
        String user = newUser();
        List<String> live = ids(c.path("live").asInt());
        List<String> tombs = ids(c.path("tombstones").asInt());
        seedRoutines(user, live, tombs, 1, "2026-10-01 06:00:00.000");
        // A tombstone that a pushed new id loses to is newer than the push.
        String lostId = id();
        boolean lost = c.path("push").valueStream().anyMatch(k -> k.asString().equals("lost_to_tombstone"));
        if (lost) {
            seedRoutines(user, List.of(), List.of(lostId), 2, "2026-10-07 06:00:00.000");
        }
        int liveBefore = live(user);
        int rowsBefore = count("SELECT COUNT(*) FROM routines WHERE user_id = ?", user);

        Req req = Req.of(null);
        int nextLive = 0;
        int nextTomb = 0;
        int index = 0;
        int expectedLive = liveBefore;
        for (JsonNode kind : c.path("push")) {
            switch (kind.asString()) {
                case "new" -> req.add(SyncTable.routines, routine(id(), 0, MID, null, "N" + index));
                case "new_deleted" -> req.add(SyncTable.routines, routine(id(), 0, MID, MID, "N" + index));
                case "edit" -> req.add(SyncTable.routines, routine(live.get(nextLive++), 1, MID, null, "Renamed"));
                case "delete" -> req.add(SyncTable.routines, routine(live.get(nextLive++), 1, MID, MID, "R"));
                case "revive" -> req.add(SyncTable.routines, routine(tombs.get(nextTomb++), 1, MID, null, "Back"));
                case "lost_to_tombstone" -> req.add(SyncTable.routines, routine(lostId, 1, "2026-10-05T06:00:00Z", null, "Late"));
                default -> throw new AssertionError(kind.asString());
            }
            index++;
        }
        Resp r = post(user, req.build());

        List<String> refused = new ArrayList<>();
        c.path("refused").forEach(i -> refused.add("changes.routines[" + i.asInt() + "]"));
        if (refused.isEmpty()) {
            assertThat(r.status()).as(note + " " + r.body()).isEqualTo(200);
            ContractSchemas.assertResponse("POST /sync", 200, r.body().toString());
        } else {
            assertThat(r.status()).as(note).isEqualTo(400);
            ContractSchemas.assertResponse("POST /sync", 400, r.body().toString());
            assertThat(r.body().path("code").asString()).isEqualTo("invalid_request");
            List<String> fields = new ArrayList<>();
            List<String> issues = new ArrayList<>();
            r.body().path("details").forEach(d -> {
                fields.add(d.path("field").asString());
                issues.add(d.path("issue").asString());
            });
            assertThat(fields).as(note).containsExactlyElementsOf(refused);
            assertThat(issues).allMatch(RoutineVectors.FILE.path("limits").path("cap_issue").asString()::equals);
            // Nothing applied: not a row, not a version, not a conflict.
            assertThat(live(user)).isEqualTo(liveBefore);
            assertThat(count("SELECT COUNT(*) FROM routines WHERE user_id = ?", user)).isEqualTo(rowsBefore);
            assertThat(count("SELECT COUNT(*) FROM routines WHERE user_id = ? AND version > 1", user)).isZero();
            assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
        }
    }

    private void assertRefusedAt(String user, Resp r, int liveBefore, String... fields) {
        assertThat(r.status()).isEqualTo(400);
        List<String> got = new ArrayList<>();
        r.body().path("details").forEach(d -> got.add(d.path("field").asString()));
        assertThat(got).containsExactly(fields);
        assertThat(live(user)).isEqualTo(liveBefore);
        assertThat(count("SELECT COUNT(*) FROM routines WHERE user_id = ? AND version > 1", user)).isZero();
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    @Test
    void aDeleteAfterTheArrivalsStillCountsFirstSoOnlyTheLastOverLimitArrivalIsRefused() {
        String user = newUser();
        List<String> live = ids(100);
        seedRoutines(user, live, List.of(), 1, "2026-10-01 06:00:00.000");
        Resp r = post(user, Req.of(null)
                .add(SyncTable.routines, routine(id(), 0, MID, null, "New one"))
                .add(SyncTable.routines, routine(id(), 0, MID, null, "New two"))
                .add(SyncTable.routines, routine(live.get(0), 1, MID, MID, "R")).build());
        assertRefusedAt(user, r, 100, "changes.routines[1]");
    }

    @Test
    void aStaleVersionRevivalThatWinsOnTimeIsCountedAsAnArrival() {
        String user = newUser();
        List<String> tombs = ids(1);
        seedRoutines(user, ids(100), tombs, 1, "2026-10-01 06:00:00.000");
        // Stored v1, pushed v0, newer updated_at, not deleted: the client wins and the routine comes back to life.
        Resp r = post(user, Req.of(null).add(SyncTable.routines, routine(tombs.get(0), 0, MID, null, "Back")).build());
        assertRefusedAt(user, r, 100, "changes.routines[0]");
    }

    @Test
    void aStaleVersionDeleteThatLosesDoesNotFreeASlot() {
        String user = newUser();
        List<String> live = ids(100);
        seedRoutines(user, live, List.of(), 1, "2026-10-01 06:00:00.000");
        // Stored v1 updated 10-01 06:00, pushed v0 with an older updated_at: the server wins, the routine stays live.
        Resp r = post(user, Req.of(null)
                .add(SyncTable.routines, routine(live.get(0), 0, "2026-09-30T06:00:00Z", "2026-09-30T06:00:00Z", "R"))
                .add(SyncTable.routines, routine(id(), 0, MID, null, "New")).build());
        assertRefusedAt(user, r, 100, "changes.routines[1]");
    }

    @Test
    void aRefusedPushLeavesOtherTablesUnwrittenToo() {
        String user = newUser();
        seedRoutines(user, ids(100), List.of(), 1, "2026-10-01 06:00:00.000");
        Resp r = post(user, Req.of(null)
                .add(SyncTable.routines, routine(id(), 0, MID, null, "Over"))
                .add(SyncTable.water_logs, SyncFixtures.waterLog(id(), 0, MID, null, 250)).build());
        assertThat(r.status()).isEqualTo(400);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", user)).isZero();
    }

    @Test
    void theRoutineCapIsCheckedBeforeTheAccountRecordCap() {
        String user = newUser();
        seedRoutines(user, ids(99), List.of(), 1, "2026-10-01 06:00:00.000");
        jdbc.update("INSERT INTO sync_state (user_id, seq, records) VALUES (?, 0, 149)", user);
        Resp r = post(user, Req.of(null)
                .add(SyncTable.routines, routine(id(), 0, MID, null, "One"))
                .add(SyncTable.routines, routine(id(), 0, MID, null, "Two")).build());
        assertThat(r.status()).isEqualTo(400); // also over the account cap, but the routine cap answers first
        assertThat(r.body().path("details").get(0).path("field").asString()).isEqualTo("changes.routines[1]");
    }

    @Test
    void theAccountRecordCapStillAppliesToRoutines() {
        String user = newUser();
        jdbc.update("INSERT INTO sync_state (user_id, seq, records) VALUES (?, 0, 150)", user);
        Resp r = post(user, Req.of(null).add(SyncTable.routines, routine(id(), 0, MID, null, "One")).build());
        assertThat(r.status()).isEqualTo(413);
        assertThat(r.body().path("code").asString()).isEqualTo("account_full");
    }

    @Test
    void twoDevicesPushingTheLastSlotAtOnceGetExactlyOne() throws Exception {
        String user = newUser();
        seedRoutines(user, ids(99), List.of(), 1, "2026-10-01 06:00:00.000");
        CountDownLatch go = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Resp>> results = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                String body = Req.of(null).add(SyncTable.routines, routine(id(), 0, MID, null, "Racer")).build().toString();
                results.add(pool.submit(() -> {
                    go.await();
                    return post(jwt.issue(user).value(), body);
                }));
            }
            go.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Resp> f : results) {
                statuses.add(f.get().status());
            }
            assertThat(statuses).containsExactlyInAnyOrder(200, 400);
            assertThat(live(user)).isEqualTo(100);
        } finally {
            pool.shutdownNow();
        }
    }
}
