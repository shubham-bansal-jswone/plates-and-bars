package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/** The startup recount of {@code sync_state.records} (#667) on real MySQL, with the cap on. */
@TestPropertySource(properties = "app.sync.max-records-per-account=100000")
class RecordRecountIT extends SyncITBase {

    static final String T = "2026-10-08T11:00:00Z";

    @Autowired RecordRecount recount;

    private long counter(String user) {
        Long n = jdbc.queryForObject("SELECT records FROM sync_state WHERE user_id = ?", Long.class, user);
        return n == null ? -1 : n;
    }

    private long rows(String user) {
        long total = 0;
        for (SyncTable t : SyncTable.values()) {
            total += count("SELECT COUNT(*) FROM " + t.sqlName() + " WHERE user_id = ?", user);
        }
        return total;
    }

    private void push(String user, int n) {
        Req r = Req.of(null);
        for (int i = 0; i < n; i++) {
            r.add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250));
        }
        ok(user, r.build());
    }

    @Test
    void aDriftedCounterIsCorrectedAndARightOneIsLeftAlone() {
        String drifted = newUser();
        push(drifted, 4);
        jdbc.update("INSERT INTO water_logs (user_id, id, version, updated_at, deleted_at, seq, data) VALUES (?, ?, 1,"
                + " NOW(3), NOW(3), 99, '{}')", drifted, id()); // a tombstone counts too
        jdbc.update("UPDATE sync_state SET records = 1000 WHERE user_id = ?", drifted);
        String right = newUser();
        push(right, 2);
        String other = newUser();
        push(other, 3);
        jdbc.update("UPDATE sync_state SET records = 0 WHERE user_id = ?", other);

        assertThat(recount.recount(right)).isFalse();
        assertThat(recount.recountAll()).isGreaterThanOrEqualTo(2);

        assertThat(rows(drifted)).isEqualTo(5);
        assertThat(counter(drifted)).isEqualTo(5);
        assertThat(counter(other)).isEqualTo(3);
        assertThat(counter(right)).isEqualTo(2);
        assertThat(recount.recountAll()).as("idempotent").isZero();
    }

    @Test
    void anAccountDeletedBeforeItsTurnIsSkipped() {
        assertThat(recount.recount(java.util.UUID.randomUUID().toString())).isFalse();
    }

    @Test
    void pushesDuringTheRecountLoseNoIncrements() throws Exception {
        var pool = Executors.newFixedThreadPool(8);
        try {
            for (int round = 0; round < 5; round++) {
                String user = newUser();
                push(user, 3);
                jdbc.update("UPDATE sync_state SET records = 0 WHERE user_id = ?", user); // drifted
                CountDownLatch go = new CountDownLatch(1);
                List<Future<?>> all = new ArrayList<>();
                for (int p = 0; p < 6; p++) {
                    all.add(pool.submit(() -> {
                        go.await();
                        push(user, 2);
                        return null;
                    }));
                }
                all.add(pool.submit(() -> {
                    go.await();
                    return recount.recountAll();
                }));
                go.countDown();
                for (Future<?> f : all) {
                    f.get();
                }
                // Either order of push and recount ends on the true number: 3 + 6 * 2 rows, counted once each.
                assertThat(rows(user)).isEqualTo(15);
                assertThat(counter(user)).isEqualTo(15);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
