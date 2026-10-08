package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.foodLog;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** The sync rules on real MySQL: versions, conflicts, retries, tombstones, paging, caps and the clock. */
class SyncEngineIT extends SyncITBase {

    static final String OLD = "2026-10-08T10:00:00Z";
    static final String MID = "2026-10-08T11:00:00Z";
    static final String NEW = "2026-10-08T11:30:00Z";

    private Req req(String cursor) {
        return Req.of(cursor);
    }

    private JsonNode only(JsonNode array) {
        assertThat(array).hasSize(1);
        return array.get(0);
    }

    private JsonNode pulled(Resp r, String table, String id) {
        for (JsonNode n : r.body().path("changes").path(table)) {
            if (n.path("id").asText().equals(id)) {
                return n;
            }
        }
        return null;
    }

    // ---- versions and basic round trip ----

    @Test
    void newRecordIsAppliedAsVersion1AndReachesAnotherDevice() {
        String user = newUser();
        String rid = id();
        Resp push = ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Poha", 291)).build());

        assertThat(push.body().path("applied")).hasSize(1);
        assertThat(only(push.body().path("applied")).path("table").asText()).isEqualTo("food_logs");
        assertThat(only(push.body().path("applied")).path("version").asInt()).isEqualTo(1);
        assertThat(push.body().path("conflicts")).isEmpty();
        assertThat(push.body().path("changes")).as("pushed records are not echoed").isEmpty();

        Resp other = ok(user, req(null).build());
        JsonNode rec = pulled(other, "food_logs", rid);
        assertThat(rec.path("version").asInt()).isEqualTo(1);
        assertThat(rec.path("name").asText()).isEqualTo("Poha");
        assertThat(rec.path("updated_at").asText()).isEqualTo(MID);
        assertThat(rec.path("deleted_at").isNull()).isTrue();
    }

    @Test
    void editWithTheCurrentVersionIsAppliedAsNextVersion() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 250)).build());
        Resp edit = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, MID, null, 500)).build());

        assertThat(only(edit.body().path("applied")).path("version").asInt()).isEqualTo(2);
        assertThat(edit.body().path("conflicts")).isEmpty();
        Resp pull = ok(user, req(null).build());
        assertThat(pulled(pull, "water_logs", rid).path("ml").asInt()).isEqualTo(500);
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    @Test
    void anOlderUpdatedAtStillAppliesWhenTheVersionMatches() {
        // The device saw the latest version, so nothing has been missed whatever its clock says.
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 250)).build());
        Resp edit = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, OLD, null, 500)).build());
        assertThat(only(edit.body().path("applied")).path("version").asInt()).isEqualTo(2);
    }

    @Test
    void unknownRecordIsNewEvenIfTheDeviceClaimsAVersion() {
        String user = newUser();
        Resp r = ok(user, req(null).add(SyncTable.water_logs, waterLog(id(), 7, MID, null, 250)).build());
        assertThat(only(r.body().path("applied")).path("version").asInt()).isEqualTo(1);
    }

    // ---- conflicts ----

    @Test
    void staleVersionWithNewerUpdatedAtWinsAndTheServerCopyIsLogged() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Server version", 100)).build());

        // A second device never saw version 1 (version 0) and edited later.
        Resp r = ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, NEW, null, "Client version", 200)).build());

        assertThat(r.body().path("applied")).isEmpty();
        JsonNode c = only(r.body().path("conflicts"));
        assertThat(c.path("resolution").asText()).isEqualTo("client_won");
        assertThat(c.path("client_version").asInt()).isZero();
        assertThat(c.path("server_version").asInt()).isEqualTo(2);
        assertThat(c.path("server_record").path("name").asText()).isEqualTo("Client version");
        assertThat(c.path("server_record").path("version").asInt()).isEqualTo(2);

        Map<String, Object> log = jdbc.queryForMap(
                "SELECT loser, version, winner_version, record FROM sync_conflicts WHERE user_id = ? AND record_id = ?", user, rid);
        assertThat(log.get("loser")).isEqualTo("server");
        assertThat(log.get("version")).isEqualTo(1);
        assertThat(log.get("winner_version")).isEqualTo(2);
        assertThat(log.get("record").toString()).contains("Server version");
        assertThat(ok(user, req(null).build()).body().path("changes").path("food_logs").get(0).path("name").asText())
                .isEqualTo("Client version");
    }

    @Test
    void staleVersionWithOlderUpdatedAtLosesAndTheClientCopyIsLogged() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, NEW, null, "Server version", 100)).build());

        Resp r = ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Client version", 200)).build());

        JsonNode c = only(r.body().path("conflicts"));
        assertThat(c.path("resolution").asText()).isEqualTo("server_won");
        assertThat(c.path("server_version").asInt()).isEqualTo(1);
        assertThat(c.path("server_record").path("name").asText()).isEqualTo("Server version");
        assertThat(r.body().path("applied")).isEmpty();

        Map<String, Object> log = jdbc.queryForMap(
                "SELECT loser, version, winner_version, record FROM sync_conflicts WHERE user_id = ? AND record_id = ?", user, rid);
        assertThat(log.get("loser")).isEqualTo("client");
        assertThat(log.get("version")).isEqualTo(0);
        assertThat(log.get("record").toString()).contains("Client version");
        // The stored record is untouched.
        assertThat(count("SELECT version FROM food_logs WHERE user_id = ? AND id = ?", user, rid)).isEqualTo(1);
    }

    @Test
    void aTieOnUpdatedAtGoesToTheServer() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Server version", 100)).build());
        Resp r = ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Client version", 200)).build());

        JsonNode c = only(r.body().path("conflicts"));
        assertThat(c.path("resolution").asText()).isEqualTo("server_won");
        assertThat(c.path("server_record").path("name").asText()).isEqualTo("Server version");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ? AND loser = 'client'", user)).isEqualTo(1);
    }

    @Test
    void conflictsAreReportedPerRecordWhileTheRestOfTheRequestIsApplied() {
        String user = newUser();
        String clash = id();
        String fresh = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(clash, 0, NEW, null, 250)).build());

        Resp r = ok(user, req(null)
                .add(SyncTable.water_logs, waterLog(clash, 0, MID, null, 999))
                .add(SyncTable.water_logs, waterLog(fresh, 0, MID, null, 300))
                .build());

        assertThat(only(r.body().path("applied")).path("id").asText()).isEqualTo(fresh);
        assertThat(only(r.body().path("conflicts")).path("id").asText()).isEqualTo(clash);
    }

    @Test
    void everyPushedRecordIsInExactlyOneOfAppliedOrConflicts() {
        String user = newUser();
        List<String> ids = new ArrayList<>();
        Req seed = req(null);
        for (int i = 0; i < 6; i++) {
            ids.add(id());
            seed.add(SyncTable.water_logs, waterLog(ids.get(i), 0, NEW, null, 100 + i));
        }
        ok(user, seed.build());

        Req push = req(null);
        for (int i = 0; i < 6; i++) {
            // 0,1: matching version; 2,3: stale and older; 4,5: stale and newer
            push.add(SyncTable.water_logs, waterLog(ids.get(i), i < 2 ? 1 : 0, i < 4 ? MID : "2026-10-08T11:45:00Z", null, 700 + i));
        }
        JsonNode body = ok(user, push.build()).body();
        Set<String> seen = new HashSet<>();
        body.path("applied").forEach(a -> assertThat(seen.add(a.path("id").asText())).isTrue());
        body.path("conflicts").forEach(a -> assertThat(seen.add(a.path("id").asText())).isTrue());
        assertThat(seen).containsExactlyInAnyOrderElementsOf(ids);
        assertThat(body.path("applied")).hasSize(2);
        assertThat(body.path("conflicts")).hasSize(4);
    }

    // ---- idempotent retries ----

    @Test
    void retryOfASuccessfulPushIsAServerWonConflictThatIsNotLogged() {
        String user = newUser();
        String rid = id();
        ObjectNode push = req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Poha", 291)).build();
        ok(user, push);

        Resp retry = ok(user, push); // same body, same stale version 0, response of the first was "lost"

        JsonNode c = only(retry.body().path("conflicts"));
        assertThat(c.path("resolution").asText()).isEqualTo("server_won");
        assertThat(c.path("client_version").asInt()).isZero();
        assertThat(c.path("server_version").asInt()).isEqualTo(1);
        assertThat(c.path("server_record").path("name").asText()).isEqualTo("Poha");
        assertThat(retry.body().path("applied")).isEmpty();
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
        assertThat(count("SELECT version FROM food_logs WHERE user_id = ? AND id = ?", user, rid)).isEqualTo(1);
    }

    @Test
    void retryOfAnEditIsRecognisedEvenWhenUpdatedAtDiffers() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 250)).build());
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, MID, null, 500)).build());

        // The device retries with the same content but a newer edit time: still the same edit, not a new one.
        Resp retry = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, NEW, null, 500)).build());
        assertThat(only(retry.body().path("conflicts")).path("resolution").asText()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
        assertThat(count("SELECT version FROM water_logs WHERE user_id = ? AND id = ?", user, rid)).isEqualTo(2);
    }

    @Test
    void retryOfAPushWhoseUpdatedAtWasClampedIsStillARetry() {
        String user = newUser();
        String rid = id();
        String future = iso(START.plus(Duration.ofHours(3)));
        ObjectNode push = req(null).add(SyncTable.water_logs, waterLog(rid, 0, future, null, 250)).build();
        ok(user, push);
        clock.advance(Duration.ofSeconds(30));

        Resp retry = ok(user, push);
        assertThat(only(retry.body().path("conflicts")).path("resolution").asText()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    @Test
    void retryOfADeleteIsARetryEvenIfTheDeleteTimeWasClamped() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 250)).build());
        String future = iso(START.plus(Duration.ofHours(3)));
        ObjectNode del = req(null).add(SyncTable.water_logs, waterLog(rid, 1, future, future, 250)).build();
        ok(user, del);
        clock.advance(Duration.ofHours(2));
        Resp retry = ok(user, del);
        assertThat(only(retry.body().path("conflicts")).path("resolution").asText()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    @Test
    void sameVersionButDifferentContentIsARealConflictAndIsLogged() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 250)).build());
        Resp r = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 251)).build());
        assertThat(only(r.body().path("conflicts")).path("resolution").asText()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isEqualTo(1);
    }

    @Test
    void numbersThatDifferOnlyInFormCountAsIdenticalContent() {
        String user = newUser();
        String rid = id();
        ObjectNode first = foodLog(rid, 0, MID, null, "Poha", 291);
        ok(user, req(null).add(SyncTable.food_logs, first).build());
        ObjectNode again = first.deepCopy();
        again.put("qty", 1.0);
        again.put("kcal", 291.0);
        Resp r = ok(user, req(null).add(SyncTable.food_logs, again).build());
        assertThat(only(r.body().path("conflicts")).path("resolution").asText()).isEqualTo("server_won");
        assertThat(count("SELECT COUNT(*) FROM sync_conflicts WHERE user_id = ?", user)).isZero();
    }

    // ---- tombstones ----

    @Test
    void aDeleteReachesAnotherDeviceAsATombstone() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 250)).build());
        String cursorB = ok(user, req(null).build()).body().path("cursor").asText(); // device B is up to date

        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, MID, MID, 250)).build()); // device A deletes

        Resp b = ok(user, req(cursorB).build());
        JsonNode tomb = pulled(b, "water_logs", rid);
        assertThat(tomb).isNotNull();
        assertThat(tomb.path("deleted_at").asText()).isEqualTo(MID);
        assertThat(tomb.path("version").asInt()).isEqualTo(2);
        // Soft delete: the row is still there.
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND id = ? AND deleted_at IS NOT NULL", user, rid))
                .isEqualTo(1);
    }

    @Test
    void aFullPullMayOmitTombstonesButAnIncrementalPullNeverDoes() {
        String user = newUser();
        String gone = id();
        String kept = id();
        ok(user, req(null)
                .add(SyncTable.water_logs, waterLog(gone, 0, OLD, null, 250))
                .add(SyncTable.water_logs, waterLog(kept, 0, OLD, null, 300))
                .build());
        ok(user, req(null).add(SyncTable.water_logs, waterLog(gone, 1, MID, MID, 250)).build());

        Resp full = ok(user, req(null).build());
        assertThat(pulled(full, "water_logs", gone)).isNull();
        assertThat(pulled(full, "water_logs", kept)).isNotNull();
        assertThat(full.body().path("has_more").asBoolean()).isFalse();
    }

    @Test
    void deleteLosesToANewerEditFromAnotherDeviceOnAStaleVersion() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 250)).build());
        // Device A edits later; device B (still at version 1) deletes earlier.
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, NEW, null, 500)).build());
        Resp r = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, MID, MID, 250)).build());

        JsonNode c = only(r.body().path("conflicts"));
        assertThat(c.path("resolution").asText()).isEqualTo("server_won");
        assertThat(c.path("server_record").path("deleted_at").isNull()).isTrue();
        assertThat(c.path("server_record").path("ml").asInt()).isEqualTo(500);
    }

    @Test
    void aNewerEditAfterADeleteBringsTheRecordBack() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, OLD, null, 250)).build());
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, MID, MID, 250)).build());
        // A device that never saw the delete edits later and wins the conflict.
        Resp r = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, NEW, null, 400)).build());
        assertThat(only(r.body().path("conflicts")).path("resolution").asText()).isEqualTo("client_won");
        assertThat(only(r.body().path("conflicts")).path("server_record").path("deleted_at").isNull()).isTrue();
    }

    @Test
    void deletingARecordTheServerNeverSawStoresTheTombstone() {
        String user = newUser();
        String rid = id();
        Resp r = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, MID, 250)).build());
        assertThat(only(r.body().path("applied")).path("version").asInt()).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ? AND deleted_at IS NOT NULL", user)).isEqualTo(1);
    }

    // ---- cursor paging, has_more, cap ----

    @Test
    void pagingWalksEveryRecordExactlyOnceAcrossTablesAndEndsWithHasMoreFalse() {
        String user = newUser();
        Set<String> expected = new HashSet<>();
        for (int batch = 0; batch < 3; batch++) {
            Req r = req(null);
            for (int i = 0; i < 400; i++) {
                String rid = id();
                expected.add(rid);
                if (i % 2 == 0) {
                    r.add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "Poha " + i, 291));
                } else {
                    r.add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 250));
                }
            }
            ok(user, r.build());
        }

        Set<String> got = new HashSet<>();
        List<Integer> pageSizes = new ArrayList<>();
        List<Boolean> more = new ArrayList<>();
        String cursor = null;
        long lastSeq = -1;
        do {
            Resp page = ok(user, req(cursor).build());
            int n = 0;
            for (String table : List.of("food_logs", "water_logs")) {
                for (JsonNode rec : page.body().path("changes").path(table)) {
                    assertThat(got.add(rec.path("id").asText())).as("no duplicates across pages").isTrue();
                    n++;
                }
            }
            pageSizes.add(n);
            more.add(page.body().path("has_more").asBoolean());
            String next = page.body().path("cursor").asText();
            long seq = Long.parseLong(next.substring(2), 16);
            assertThat(seq).as("cursor moves forward").isGreaterThan(lastSeq);
            lastSeq = seq;
            cursor = next;
        } while (more.get(more.size() - 1));

        assertThat(got).isEqualTo(expected);
        assertThat(pageSizes).containsExactly(500, 500, 200);
        assertThat(more).containsExactly(true, true, false);

        Resp after = ok(user, req(cursor).build());
        assertThat(after.body().path("changes")).isEmpty();
        assertThat(after.body().path("has_more").asBoolean()).isFalse();
        assertThat(after.body().path("cursor").asText()).isEqualTo(cursor);
    }

    @Test
    void exactly500RecordsFitOnOnePageWithoutHasMore() {
        String user = newUser();
        Req r = req(null);
        for (int i = 0; i < 500; i++) {
            r.add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250));
        }
        Resp push = ok(user, r.build());
        assertThat(push.body().path("applied")).hasSize(500);

        Resp pull = ok(user, req(null).build());
        assertThat(pull.body().path("changes").path("water_logs")).hasSize(500);
        assertThat(pull.body().path("has_more").asBoolean()).isFalse();
    }

    @Test
    void moreThan500RecordsIsRejectedAndNothingIsStored() {
        String user = newUser();
        Req r = req(null);
        for (int i = 0; i < 501; i++) {
            r.add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250));
        }
        Resp res = post(user, r.build());
        assertThat(res.status()).isEqualTo(400);
        assertThat(res.body().path("code").asText()).isEqualTo("invalid_request");
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", user)).isZero();
    }

    @Test
    void aPullPageIsFollowedWhileTheDeviceAlsoPushesWithoutEchoingItsOwnRecords() {
        String user = newUser();
        Req seed = req(null);
        for (int i = 0; i < 300; i++) {
            seed.add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250));
        }
        ok(user, seed.build());
        Req seed2 = req(null);
        for (int i = 0; i < 300; i++) {
            seed2.add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250));
        }
        ok(user, seed2.build());

        String mine = id();
        Resp r = ok(user, req(null).add(SyncTable.food_logs, foodLog(mine, 0, MID, null, "Mine", 1)).build());
        assertThat(r.body().path("has_more").asBoolean()).isTrue();
        assertThat(r.body().path("changes").path("water_logs")).hasSize(500);
        assertThat(pulled(r, "food_logs", mine)).as("own push not echoed").isNull();
        assertThat(only(r.body().path("applied")).path("id").asText()).isEqualTo(mine);
    }

    @Test
    void afterAPushTheReturnedCursorSkipsTheDevicesOwnWrites() {
        String user = newUser();
        Resp push = ok(user, req(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250)).build());
        Resp next = ok(user, req(push.body().path("cursor").asText()).build());
        assertThat(next.body().path("changes")).isEmpty();
    }

    @Test
    void anotherDevicesChangeShowsUpAfterTheCursorAndOnlyThen() {
        String user = newUser();
        String a = id();
        String b = id();
        Resp first = ok(user, req(null).add(SyncTable.water_logs, waterLog(a, 0, MID, null, 250)).build());
        String cursor = first.body().path("cursor").asText();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(b, 0, MID, null, 300)).build()); // another device

        Resp pull = ok(user, req(cursor).build());
        assertThat(pulled(pull, "water_logs", b)).isNotNull();
        assertThat(pulled(pull, "water_logs", a)).isNull();
    }

    @Test
    void badCursorsAreRejected() {
        String user = newUser();
        assertThat(post(user, req("c_ffffffffffffff00").build()).status()).isEqualTo(400);
        // Beyond what this user has ever been given: a cursor from nowhere, not a position in this history.
        assertThat(post(user, req("c_0000000000000064").build()).status()).isEqualTo(400);
        assertThat(post(user, req("nonsense").build()).status()).isEqualTo(400);
        assertThat(post(user, req("c_0000000000000000").build()).status()).isEqualTo(200);
    }

    // ---- the clock ----

    @Test
    void updatedAtMoreThanFiveMinutesAheadIsClampedToServerTime() {
        String user = newUser();
        String far = id();
        String near = id();
        ok(user, req(null)
                .add(SyncTable.water_logs, waterLog(far, 0, iso(START.plus(Duration.ofMinutes(6))), null, 250))
                .add(SyncTable.water_logs, waterLog(near, 0, iso(START.plus(Duration.ofMinutes(4))), null, 250))
                .build());
        Resp pull = ok(user, req(null).build());
        assertThat(pulled(pull, "water_logs", far).path("updated_at").asText()).isEqualTo(iso(START));
        assertThat(pulled(pull, "water_logs", near).path("updated_at").asText()).isEqualTo(iso(START.plus(Duration.ofMinutes(4))));
    }

    @Test
    void aFutureEditTimeCannotBeatLaterEditsForever() {
        String user = newUser();
        String rid = id();
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 250)).build());
        // A device with a clock a year ahead edits with a stale version; its edit time counts as "now".
        String year = "2027-10-08T12:00:00Z";
        Resp r = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, year, null, 999)).build());
        assertThat(only(r.body().path("conflicts")).path("resolution").asText()).isEqualTo("client_won");
        assertThat(only(r.body().path("conflicts")).path("server_record").path("updated_at").asText()).isEqualTo(iso(START));
        // The clamped time is real server time, so a later honest edit from another device still wins.
        clock.advance(Duration.ofMinutes(10));
        Resp later = ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 1, iso(START.plus(Duration.ofMinutes(10))), null, 100)).build());
        assertThat(only(later.body().path("conflicts")).path("resolution").asText()).isEqualTo("client_won");
    }

    @Test
    void aTombstoneTimeInTheFutureIsClampedToo() {
        String user = newUser();
        String rid = id();
        String far = iso(START.plus(Duration.ofDays(2)));
        ok(user, req(null).add(SyncTable.water_logs, waterLog(rid, 0, far, far, 250)).build());
        Resp pull = ok(user, req("c_0000000000000000").build());
        assertThat(pulled(pull, "water_logs", rid).path("deleted_at").asText()).isEqualTo(iso(START));
    }

    // ---- atomic validation, accounts, hygiene ----

    @Test
    void anInvalidRecordRejectsTheWholeRequestAndAppliesNothing() {
        String user = newUser();
        String good = id();
        Resp r = post(user, req(null)
                .add(SyncTable.water_logs, waterLog(good, 0, MID, null, 250))
                .add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 0))
                .build());
        assertThat(r.status()).isEqualTo(400);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", user)).isZero();
        assertThat(count("SELECT COUNT(*) FROM sync_state WHERE user_id = ?", user)).isZero();
    }

    @Test
    void aValidTokenForAnAccountThatNoLongerExistsIs401() {
        String ghost = java.util.UUID.randomUUID().toString();
        Resp r = post(ghost, req(null).build());
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.body().path("code").asText()).isEqualTo("unauthorized");
    }

    @Test
    void missingOrBadTokenIs401() {
        assertThat(post((String) null, "{\"cursor\":null,\"changes\":{}}").status()).isEqualTo(401);
        assertThat(post("not.a.jwt", "{\"cursor\":null,\"changes\":{}}").status()).isEqualTo(401);
    }

    @Test
    void everyTableRoundTripsAndConcurrentDevicesOfOneUserNeverShareAChangeNumber() throws Exception {
        String user = newUser();
        Map<SyncTable, ObjectNode> all = SyncFixtures.oneOfEach(user, MID);
        Req r = req(null);
        all.forEach(r::add);
        Resp push = ok(user, r.build());
        assertThat(push.body().path("applied")).hasSize(SyncTable.values().length);

        Resp pull = ok(user, req(null).build());
        for (Map.Entry<SyncTable, ObjectNode> e : all.entrySet()) {
            JsonNode got = pulled(pull, e.getKey().name(), e.getValue().path("id").asText());
            assertThat(got).as(e.getKey().name()).isNotNull();
            ObjectNode expected = e.getValue().deepCopy();
            expected.put("version", 1);
            assertThat(JsonContent.same(got, expected)).as(e.getKey().name() + " round trip").isTrue();
        }

        // Two devices pushing at the same moment: every record gets its own change number.
        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        List<java.util.concurrent.Future<Resp>> fs = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            ObjectNode body = req(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250)).build();
            fs.add(pool.submit(() -> post(user, body)));
        }
        for (var f : fs) {
            assertThat(f.get().status()).isEqualTo(200);
        }
        pool.shutdown();
        assertThat(count("SELECT COUNT(DISTINCT seq) FROM water_logs WHERE user_id = ?", user)).isEqualTo(8 + 1);
    }

    @Test
    void recordContentsNeverReachTheLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        List<String> names = List.of(
                "app.plateandbar",
                "org.springframework.security",
                "org.springframework.web.servlet",
                "org.springframework.web.filter",
                "org.springframework.jdbc",
                "org.springframework.transaction");
        // Server-side machinery only: the test's own HTTP client would log the request bodies it sends.
        for (String n : names) {
            ((Logger) LoggerFactory.getLogger(n)).setLevel(Level.TRACE);
        }
        ListAppender<ILoggingEvent> logs = new ListAppender<>();
        logs.start();
        root.addAppender(logs);
        try {
            String user = newUser();
            String rid = id();
            ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, NEW, null, "ZZ-SECRET-FOOD", 291)).build());
            ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, MID, null, "ZZ-OTHER-SECRET", 292)).build());
            ok(user, req(null).add(SyncTable.food_logs, foodLog(rid, 0, NEW, null, "ZZ-NEWER-SECRET", 293)).build());
            ObjectNode bad = foodLog(id(), 0, MID, null, "ZZ-BAD-SECRET", 1);
            bad.put("meal", "ZZ-BAD-MEAL");
            post(user, req(null).add(SyncTable.food_logs, bad).build());
            post(user, "{\"cursor\":\"ZZ-BAD-CURSOR\",\"changes\":{}}");
        } finally {
            root.detachAppender(logs);
            for (String n : names) {
                ((Logger) LoggerFactory.getLogger(n)).setLevel(null);
            }
        }
        for (ILoggingEvent e : logs.list) {
            String line = e.getFormattedMessage()
                    + (e.getThrowableProxy() == null ? "" : ThrowableProxyUtil.asString(e.getThrowableProxy()));
            assertThat(line).doesNotContain("ZZ-");
        }
    }
}
