package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** V4 gives every SyncTable the columns the project requires of user-owned tables. */
class SyncMigrationIT extends SyncITBase {

    @Test
    void everySyncTableHasUserIdVersionUpdatedAtAndDeletedAt() {
        for (SyncTable t : SyncTable.values()) {
            List<String> cols = jdbc.queryForList(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
                    String.class,
                    t.sqlName());
            assertThat(cols).as(t.name()).contains("user_id", "id", "version", "updated_at", "deleted_at", "seq", "data");
        }
        assertThat(jdbc.queryForList(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'sync_conflicts'",
                        String.class))
                .contains("user_id", "version", "updated_at", "deleted_at");
    }

    @Test
    void recordIdsDoNotFoldCase() {
        String user = newUser();
        String sql = "INSERT INTO water_logs (user_id, id, version, updated_at, seq, data) VALUES (?, ?, 1, NOW(3), 1, '{}')";
        jdbc.update(sql, user, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        jdbc.update(sql, user, "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", user)).isEqualTo(2);
    }
}
