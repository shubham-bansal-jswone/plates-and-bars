package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.oneOfEach;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

/**
 * {@code sync_state.records} (V8) with the cap off, which is the shipped default: nothing is ever refused, and the
 * counter is still kept right, so turning the cap on later needs no recount. Also the V8 backfill.
 */
class SyncRecordCountIT extends SyncITBase {

    static final String T = "2026-10-08T11:00:00Z";

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

    @Test
    void withTheCapOffNothingIsRefusedHoweverManyRecordsAreStored() {
        String user = newUser();
        for (int batch = 0; batch < 3; batch++) {
            Req r = Req.of(null);
            for (int i = 0; i < 100; i++) {
                r.add(SyncTable.water_logs, waterLog(id(), 0, T, null, 250));
            }
            ok(user, r.build());
        }
        assertThat(rows(user)).isEqualTo(300);
        assertThat(counter(user)).isEqualTo(300);
    }

    @Test
    void theCounterFollowsNewRecordsAcrossAllSixteenTablesAndNotEditsDeletesOrRetries() {
        String user = newUser();
        var records = oneOfEach(user, T);
        Req first = Req.of(null);
        records.forEach(first::add);
        ok(user, first.build());
        assertThat(rows(user)).isEqualTo(16);
        assertThat(counter(user)).isEqualTo(16);

        // Retry of the same push (still version 0), an edit and a delete: no new rows.
        ok(user, Req.of(null).add(SyncTable.water_logs, records.get(SyncTable.water_logs)).build());
        String rid = jdbc.queryForObject("SELECT id FROM water_logs WHERE user_id = ?", String.class, user);
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 1, "2026-10-08T11:30:00Z", "2026-10-08T11:30:00Z", 250)).build());
        assertThat(rows(user)).isEqualTo(16);
        assertThat(counter(user)).isEqualTo(16);

        // A tombstone for a record the server never saw is stored, so it counts.
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, T, T, 250)).build());
        assertThat(counter(user)).isEqualTo(17).isEqualTo(rows(user));
    }

    @Test
    void v8BackfillsTheCounterFromAllSixteenTablesIncludingTombstones() throws Exception {
        String url = MYSQL.getJdbcUrl().replace("/" + MYSQL.getDatabaseName(), "/");
        String schema = "backfill_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection root = DriverManager.getConnection(url, "root", MYSQL.getPassword());
                Statement st = root.createStatement()) {
            st.execute("CREATE DATABASE " + schema);
            try {
                String schemaUrl = url + schema;
                Flyway.configure().dataSource(schemaUrl, "root", MYSQL.getPassword())
                        .locations("classpath:db/migration").target("7").load().migrate();

                String a = UUID.randomUUID().toString();
                String b = UUID.randomUUID().toString();
                String none = UUID.randomUUID().toString();
                for (String u : new String[] {a, b, none}) {
                    st.execute("INSERT INTO " + schema + ".users (id, email) VALUES ('" + u + "', '" + u + "@example.com')");
                    st.execute("INSERT INTO " + schema + ".sync_state (user_id, seq) VALUES ('" + u + "', 0)");
                }
                // User a: one row in each of the 16 tables, two of them tombstones, plus a conflict log entry (not counted).
                int n = 0;
                for (SyncTable t : SyncTable.values()) {
                    st.execute("INSERT INTO " + schema + "." + t.sqlName() + " (user_id, id, version, updated_at, deleted_at, seq, data)"
                            + " VALUES ('" + a + "', '" + UUID.randomUUID() + "', 1, NOW(3), " + (n++ < 2 ? "NOW(3)" : "NULL") + ", 1, '{}')");
                }
                st.execute("INSERT INTO " + schema + ".water_logs (user_id, id, version, updated_at, seq, data) VALUES ('"
                        + a + "', '" + UUID.randomUUID() + "', 1, NOW(3), 1, '{}')");
                st.execute("INSERT INTO " + schema + ".sync_conflicts (user_id, table_name, record_id, loser, version, winner_version,"
                        + " updated_at, record, logged_at) VALUES ('" + a + "', 'water_logs', '" + UUID.randomUUID()
                        + "', 'client', 1, 2, NOW(3), '{}', NOW(3))");
                // User b: two rows. User none: nothing.
                for (int i = 0; i < 2; i++) {
                    st.execute("INSERT INTO " + schema + ".food_logs (user_id, id, version, updated_at, seq, data) VALUES ('"
                            + b + "', '" + UUID.randomUUID() + "', 1, NOW(3), 1, '{}')");
                }

                Flyway.configure().dataSource(schemaUrl, "root", MYSQL.getPassword())
                        .locations("classpath:db/migration").load().migrate();

                assertThat(recordsOf(st, schema, a)).isEqualTo(17);
                assertThat(recordsOf(st, schema, b)).isEqualTo(2);
                assertThat(recordsOf(st, schema, none)).isZero();
            } finally {
                st.execute("DROP DATABASE " + schema);
            }
        }
    }

    private static long recordsOf(Statement st, String schema, String user) throws Exception {
        try (ResultSet rs = st.executeQuery("SELECT records FROM " + schema + ".sync_state WHERE user_id = '" + user + "'")) {
            assertThat(rs.next()).isTrue();
            return rs.getLong(1);
        }
    }
}
