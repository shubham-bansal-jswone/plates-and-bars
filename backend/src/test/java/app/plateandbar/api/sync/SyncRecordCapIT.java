package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.foodLog;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.naturalId;
import static app.plateandbar.api.sync.SyncFixtures.obj;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static app.plateandbar.api.sync.SyncFixtures.withMeta;
import static org.assertj.core.api.Assertions.assertThat;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/**
 * Per-account record cap (#349, contract 0.1.16) on real MySQL, with the limit set to 5: 413 {@code account_full} for a
 * push with new records that would go over it, never for anything else, and never a partial apply.
 */
@TestPropertySource(properties = "app.sync.max-records-per-account=5")
class SyncRecordCapIT extends SyncITBase {

    static final int LIMIT = 5;
    static final String T = "2026-10-08T11:00:00Z";
    static final String LATER = "2026-10-08T11:30:00Z";

    private Req req(String cursor) {
        return Req.of(cursor);
    }

    /** Pushes n new water logs (all must be accepted) and returns their ids. */
    private List<String> fill(String user, int n) {
        List<String> ids = new ArrayList<>();
        Req r = req(null);
        for (int i = 0; i < n; i++) {
            String rid = id();
            ids.add(rid);
            r.add(SyncTable.water_logs, waterLog(rid, 0, T, null, 250));
        }
        ok(user, r.build());
        return ids;
    }

    private long seq(String user) {
        Long n = jdbc.queryForObject("SELECT seq FROM sync_state WHERE user_id = ?", Long.class, user);
        return n == null ? -1 : n;
    }

    private long counter(String user) {
        Long n = jdbc.queryForObject("SELECT records FROM sync_state WHERE user_id = ?", Long.class, user);
        return n == null ? -1 : n;
    }

    private int rows(String user) {
        int total = 0;
        for (SyncTable t : SyncTable.values()) {
            total += count("SELECT COUNT(*) FROM " + t.sqlName() + " WHERE user_id = ?", user);
        }
        return total;
    }

    private void assertRefused(Resp r, long stored, long newRecords) {
        assertThat(r.status()).as(r.body().toString()).isEqualTo(413);
        assertThat(r.body().path("code").asString()).isEqualTo("account_full");
        assertThat(r.body().path("record_cap").path("limit").asLong()).isEqualTo(LIMIT);
        assertThat(r.body().path("record_cap").path("stored").asLong()).isEqualTo(stored);
        assertThat(r.body().path("record_cap").path("new_records").asLong()).isEqualTo(newRecords);
    }

    /** Rows that exist before a limit was lowered: inserted straight into the table, counter set to the true count. */
    private void seed(String user, int n) {
        jdbc.update("INSERT INTO sync_state (user_id, seq) VALUES (?, 0) ON DUPLICATE KEY UPDATE seq = seq", user);
        for (int i = 0; i < n; i++) {
            jdbc.update("INSERT INTO water_logs (user_id, id, version, updated_at, seq, data) VALUES (?, ?, 1, NOW(3), ?,"
                    + " '{\"date\":\"2026-10-08\",\"ml\":250}')", user, id(), i + 1);
        }
        jdbc.update("UPDATE sync_state SET records = ?, seq = ? WHERE user_id = ?", rows(user), n, user);
    }

    @Test
    void exactlyAtTheLimitIsAccepted() {
        String user = newUser();
        fill(user, LIMIT);
        assertThat(rows(user)).isEqualTo(LIMIT);
        assertThat(counter(user)).isEqualTo(LIMIT);
    }

    @Test
    void oneOverIsRefusedWithNothingAppliedPulledLoggedOrMoved() {
        String user = newUser();
        List<String> have = fill(user, 3);
        long seqBefore = seq(user);
        // Another device's record the refused request would pull, and a stored record it would edit and one it would
        // conflict on (an older edit loses and would be logged).
        String edited = have.get(0);
        ObjectNode edit = waterLog(edited, 1, LATER, null, 999);
        ObjectNode stale = waterLog(have.get(1), 0, "2026-10-08T09:00:00Z", null, 111);

        Resp r = post(user, req(null).add(SyncTable.water_logs, edit).add(SyncTable.water_logs, stale)
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1))
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 2))
                .add(SyncTable.food_logs, foodLog(id(), 0, T, null, "Poha", 291)).build());

        assertRefused(r, 3, 3);
        assertThat(r.body().has("cursor")).as("nothing pulled").isFalse();
        assertThat(r.body().has("changes")).isFalse();
        assertThat(rows(user)).isEqualTo(3);
        assertThat(counter(user)).isEqualTo(3);
        assertThat(seq(user)).as("cursor unchanged").isEqualTo(seqBefore);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND id = ? AND version = 1", user, edited))
                .as("the edit in the refused push is not applied").isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    @Test
    void theBodyMatchesTheContractsAccountFullExample() {
        String user = newUser();
        fill(user, LIMIT);
        Resp r = post(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250)).build());

        assertThat(ContractSchemas.validate("Error", r.body())).isEmpty();
        JsonNode example = ContractSchemas.responseExample("AccountFull");
        assertThat(example.path("code").asString()).isEqualTo("account_full");
        assertThat(r.body().propertyNames()).containsExactlyInAnyOrderElementsOf(example.propertyNames());
        assertThat(r.body().path("message").asString()).isEqualTo(example.path("message").asString());
        assertThat(r.body().path("record_cap").propertyNames())
                .containsExactlyInAnyOrderElementsOf(example.path("record_cap").propertyNames());
        assertThat(r.body().path("record_cap").path("limit").isIntegralNumber()).isTrue();
        assertThat(r.body().path("record_cap").path("stored").isIntegralNumber()).isTrue();
        assertThat(r.body().path("record_cap").path("new_records").isIntegralNumber()).isTrue();
    }

    @Test
    void editsAndDeletesOnlyPushesAndPullOnlyRequestsPassWhenFull() {
        String user = newUser();
        List<String> have = fill(user, LIMIT);

        Resp pull = ok(user, req(null).build());
        assertThat(pull.body().path("changes").path("water_logs")).hasSize(LIMIT);

        Resp edit = ok(user, req(null)
                .add(SyncTable.water_logs, waterLog(have.get(0), 1, LATER, null, 500))
                .add(SyncTable.water_logs, waterLog(have.get(1), 1, LATER, LATER, 250)) // delete
                .build());
        assertThat(edit.body().path("applied")).hasSize(2);
        assertThat(rows(user)).as("tombstones stay stored and counted").isEqualTo(LIMIT);
        assertThat(counter(user)).isEqualTo(LIMIT);

        // A retry of a push that already succeeded (still version 0 on the device) is not new either.
        Resp retry = ok(user, req(null).add(SyncTable.water_logs, waterLog(have.get(2), 0, T, null, 250)).build());
        assertThat(retry.body().path("conflicts")).hasSize(1);
        assertThat(retry.body().path("conflicts").get(0).path("resolution").asString()).isEqualTo("server_won");
    }

    @Test
    void whenStoredIsAlreadyOverALoweredLimitEditsDeletesAndPullsStillPassButNewRecordsAreRefused() {
        String user = newUser();
        seed(user, 8); // 8 stored, limit 5
        String existing = jdbc.queryForObject("SELECT id FROM water_logs WHERE user_id = ? LIMIT 1", String.class, user);

        assertThat(ok(user, req(null).build()).body().path("changes").path("water_logs")).hasSize(8);
        Resp edit = ok(user, req(null).add(SyncTable.water_logs, waterLog(existing, 1, LATER, LATER, 250)).build());
        assertThat(edit.body().path("applied")).hasSize(1);

        Resp r = post(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250)).build());
        assertRefused(r, 8, 1);
        assertThat(rows(user)).isEqualTo(8);
    }

    @Test
    void overALoweredLimitAPlainEditAndAnIdempotentRetryStillPass() {
        String user = newUser();
        seed(user, 8); // 8 stored, limit 5
        List<String> ids = jdbc.queryForList("SELECT id FROM water_logs WHERE user_id = ? ORDER BY id", String.class, user);

        // A plain edit (not a delete) of a stored record at the version the device last saw.
        Resp edit = ok(user, req(null).add(SyncTable.water_logs, waterLog(ids.get(0), 1, LATER, null, 777)).build());
        assertThat(edit.body().path("applied")).hasSize(1);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND id = ? AND version = 2", user, ids.get(0)))
                .isEqualTo(1);

        // The same push again (the device never saw the answer): a retry of a success, server_won, nothing written.
        Resp retry = ok(user, req(null).add(SyncTable.water_logs, waterLog(ids.get(0), 1, LATER, null, 777)).build());
        assertThat(retry.body().path("conflicts")).hasSize(1);
        assertThat(retry.body().path("conflicts").get(0).path("resolution").asString()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND id = ? AND version = 2", user, ids.get(0)))
                .isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
        assertThat(rows(user)).isEqualTo(8);
        assertThat(counter(user)).isEqualTo(8);
    }

    @Test
    void aNewTombstoneIsANewRecord() {
        String user = newUser();
        fill(user, LIMIT);
        Resp r = post(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, T, T, 250)).build());
        assertRefused(r, LIMIT, 1);
    }

    @Test
    void theSameIdInAnotherTableStillCountsAsNew() {
        String user = newUser();
        List<String> have = fill(user, LIMIT);
        // The id is stored in water_logs; in food_logs it is a different record.
        Resp r = post(user, req(null).add(SyncTable.food_logs, foodLog(have.get(0), 0, T, null, "Poha", 291)).build());
        assertRefused(r, LIMIT, 1);
    }

    @Test
    void anotherAccountsRecordsNeitherCountNorMakeAnIdOld() {
        String full = newUser();
        List<String> have = fill(full, LIMIT);
        String other = newUser();

        // The other account has room, and storing the very same id there is a new record of its own.
        Resp ok = ok(other, req(null).add(SyncTable.water_logs, waterLog(have.get(0), 0, T, null, 250)).build());
        assertThat(ok.body().path("applied")).hasSize(1);
        assertThat(counter(other)).isEqualTo(1);
        assertThat(counter(full)).isEqualTo(LIMIT);

        // And the full account is refused for an id that exists only under the other account.
        String onlyOther = id();
        ok(other, req(null).add(SyncTable.water_logs, waterLog(onlyOther, 0, T, null, 250)).build());
        Resp r = post(full, req(null).add(SyncTable.water_logs, waterLog(onlyOther, 0, T, null, 250)).build());
        assertRefused(r, LIMIT, 1);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND id = ?", full, onlyOther)).isZero();
    }

    @Test
    void anExistingNaturalKeyRecordIsNotNewAndAWrongNaturalKeyIdIs400BeforeTheCap() {
        String user = newUser();
        String weightId = naturalId(user, "weights", "2026-10-08");
        ok(user, req(null).add(SyncTable.weights,
                withMeta(obj("{'date':'2026-10-08','weight_kg':81.4}"), weightId, 0, T, null)).build());
        fill(user, LIMIT - 1);
        assertThat(counter(user)).isEqualTo(LIMIT);

        // A second device that never synced pushes the same day at version 0: same id, so not new.
        Resp again = ok(user, req(null).add(SyncTable.weights,
                withMeta(obj("{'date':'2026-10-08','weight_kg':82}"), weightId, 0, LATER, null)).build());
        assertThat(again.body().path("conflicts")).hasSize(1);
        assertThat(counter(user)).isEqualTo(LIMIT);

        // The natural-key check (400) runs before the cap (413) even though this push has a new record.
        Resp wrongId = post(user, req(null).add(SyncTable.weights,
                withMeta(obj("{'date':'2026-10-09','weight_kg':82}"), id(), 0, LATER, null)).build());
        assertThat(wrongId.status()).isEqualTo(400);
        assertThat(wrongId.body().path("code").asString()).isEqualTo("invalid_request");

        // A natural-key record for a new day is new.
        Resp newDay = post(user, req(null).add(SyncTable.weights, withMeta(obj("{'date':'2026-10-09','weight_kg':82}"),
                naturalId(user, "weights", "2026-10-09"), 0, LATER, null)).build());
        assertRefused(newDay, LIMIT, 1);
    }

    @Test
    void aPushOfEditsAndNewRecordsIsRefusedWholeWhenTheNewOnesDoNotFit() {
        String user = newUser();
        List<String> have = fill(user, 4);
        Resp r = post(user, req(null)
                .add(SyncTable.water_logs, waterLog(have.get(0), 1, LATER, null, 700))
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250))
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250)).build());
        assertRefused(r, 4, 2);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND version = 2", user)).isZero();

        // One new record fits: 4 + 1 = 5.
        Resp fits = ok(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250)).build());
        assertThat(fits.body().path("applied")).hasSize(1);
    }

    @Test
    void conflictsDoNotChangeTheCount() {
        String user = newUser();
        List<String> have = fill(user, 2);
        ok(user, req(null).add(SyncTable.water_logs, waterLog(have.get(0), 0, LATER, null, 999)).build()); // client_won
        ok(user, req(null).add(SyncTable.water_logs, waterLog(have.get(1), 0, "2026-10-08T09:00:00Z", null, 1)).build()); // server_won
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isEqualTo(2);
        assertThat(counter(user)).isEqualTo(2);
        assertThat(counter(user)).isEqualTo(rows(user));
    }

    @Test
    void theRefusedAccountCanKeepSyncingAfterTheLimitIsNotExceeded() {
        // First sync of a new account that is refused: the sync_state row it started is rolled back with the rest.
        String user = newUser();
        Resp r = post(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1))
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1)).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1))
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1)).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1))
                .add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1)).build());
        assertRefused(r, 0, 6);
        assertThat(count("SELECT COUNT(*) FROM sync_state WHERE user_id = ?", user)).isZero();
        assertThat(ok(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, T, null, 1)).build()).body().path("applied"))
                .hasSize(1);
    }

    @Test
    void twoConcurrentPushesCannotTogetherOverrunTheLimit() throws Exception {
        String user = newUser();
        // 3 + 3 is over 5: exactly one wins.
        List<Resp> two = concurrently(user, 2, 3);
        assertThat(two.stream().filter(x -> x.status() == 200)).hasSize(1);
        assertThat(two.stream().filter(x -> x.status() == 413)).hasSize(1);
        assertThat(rows(user)).isEqualTo(3);
        assertThat(counter(user)).isEqualTo(3);
    }

    @Test
    void manyConcurrentSingleRecordPushesStopExactlyAtTheLimit() throws Exception {
        String user = newUser();
        List<Resp> all = concurrently(user, 12, 1);
        assertThat(all.stream().filter(x -> x.status() == 200)).hasSize(LIMIT);
        assertThat(all.stream().filter(x -> x.status() == 413)).hasSize(12 - LIMIT);
        assertThat(rows(user)).isEqualTo(LIMIT);
        assertThat(counter(user)).isEqualTo(LIMIT);
    }

    /** {@code pushes} devices of one user each push {@code each} new records at the same moment. */
    private List<Resp> concurrently(String user, int pushes, int each) throws Exception {
        var pool = Executors.newFixedThreadPool(pushes);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Resp>> futures = new ArrayList<>();
            for (int p = 0; p < pushes; p++) {
                Req r = req(null);
                for (int i = 0; i < each; i++) {
                    r.add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250));
                }
                JsonNode body = r.build();
                futures.add(pool.submit(() -> {
                    go.await();
                    return post(user, body);
                }));
            }
            go.countDown();
            List<Resp> out = new ArrayList<>();
            for (Future<Resp> f : futures) {
                out.add(f.get());
            }
            return out;
        } finally {
            pool.shutdownNow();
        }
    }
}
