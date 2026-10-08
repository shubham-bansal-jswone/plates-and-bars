package app.plateandbar.api.sync;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * All SQL for sync. Every statement is scoped by {@code user_id}, which always comes from the
 * authenticated token via the service, never from a payload. Table names come from {@link SyncTable}.
 */
@Repository
class SyncRepository {

    /** A stored record. {@code data} holds every field except id, version, updated_at and deleted_at. */
    record Stored(String id, int version, Instant updatedAt, Instant deletedAt, long seq, JsonNode data) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    SyncRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * Locks the user's change counter until the transaction ends (creating it on the first sync) and
     * returns the current change number, or null when the user does not exist.
     */
    Long lockState(String userId) {
        String select = "SELECT seq FROM sync_state WHERE user_id = ? FOR UPDATE";
        List<Long> seq = jdbc.queryForList(select, Long.class, userId);
        if (seq.isEmpty()) {
            // IGNORE: a concurrent first sync may have created it; an unknown user leaves no row.
            jdbc.update("INSERT IGNORE INTO sync_state (user_id, seq) VALUES (?, 0)", userId);
            seq = jdbc.queryForList(select, Long.class, userId);
        }
        return seq.isEmpty() ? null : seq.get(0);
    }

    void saveSeq(String userId, long seq) {
        jdbc.update("UPDATE sync_state SET seq = ? WHERE user_id = ?", seq, userId);
    }

    Map<String, Stored> find(SyncTable table, String userId, Collection<String> ids) {
        Map<String, Stored> found = new HashMap<>();
        if (ids.isEmpty()) {
            return found;
        }
        String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        Object[] args = new Object[ids.size() + 1];
        args[0] = userId;
        int i = 1;
        for (String id : ids) {
            args[i++] = id;
        }
        jdbc.query(
                "SELECT id, version, updated_at, deleted_at, seq, data FROM " + table.sqlName()
                        + " WHERE user_id = ? AND id IN (" + marks + ")",
                (rs, n) -> {
                    Stored s = map(rs);
                    found.put(s.id(), s);
                    return s;
                },
                args);
        return found;
    }

    void insert(SyncTable table, String userId, Stored r) {
        jdbc.update(
                "INSERT INTO " + table.sqlName()
                        + " (user_id, id, version, updated_at, deleted_at, seq, data) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))",
                userId,
                r.id(),
                r.version(),
                utc(r.updatedAt()),
                utc(r.deletedAt()),
                r.seq(),
                text(r.data()));
    }

    void update(SyncTable table, String userId, Stored r) {
        int n = jdbc.update(
                "UPDATE " + table.sqlName()
                        + " SET version = ?, updated_at = ?, deleted_at = ?, seq = ?, data = CAST(? AS JSON)"
                        + " WHERE user_id = ? AND id = ?",
                r.version(),
                utc(r.updatedAt()),
                utc(r.deletedAt()),
                r.seq(),
                text(r.data()),
                userId,
                r.id());
        if (n != 1) {
            throw new IllegalStateException("sync update touched " + n + " rows");
        }
    }

    /** Records changed after {@code afterSeq} up to and including {@code uptoSeq}, oldest change first. */
    List<Stored> changedSince(
            SyncTable table, String userId, long afterSeq, long uptoSeq, boolean withTombstones, int limit) {
        return jdbc.query(
                "SELECT id, version, updated_at, deleted_at, seq, data FROM " + table.sqlName()
                        + " WHERE user_id = ? AND seq > ? AND seq <= ?"
                        + (withTombstones ? "" : " AND deleted_at IS NULL")
                        + " ORDER BY seq LIMIT ?",
                (rs, n) -> map(rs),
                userId,
                afterSeq,
                uptoSeq,
                limit);
    }

    /** Keeps the losing copy of a real conflict. {@code loser} is "client" or "server". */
    void logConflict(
            String userId, SyncTable table, String loser, int winnerVersion, Stored losing, Instant loggedAt) {
        jdbc.update(
                "INSERT INTO sync_conflicts (user_id, table_name, record_id, loser, version, winner_version,"
                        + " updated_at, deleted_at, record, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)",
                userId,
                table.sqlName(),
                losing.id(),
                loser,
                losing.version(),
                winnerVersion,
                utc(losing.updatedAt()),
                utc(losing.deletedAt()),
                text(losing.data()),
                utc(loggedAt));
    }

    private Stored map(ResultSet rs) throws SQLException {
        try {
            return new Stored(
                    rs.getString("id"),
                    rs.getInt("version"),
                    rs.getObject("updated_at", LocalDateTime.class).toInstant(ZoneOffset.UTC),
                    rs.getObject("deleted_at", LocalDateTime.class) == null
                            ? null
                            : rs.getObject("deleted_at", LocalDateTime.class).toInstant(ZoneOffset.UTC),
                    rs.getLong("seq"),
                    json.readTree(rs.getString("data")));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("stored record is not valid JSON", e);
        }
    }

    private String text(JsonNode data) {
        try {
            return json.writeValueAsString(data);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** DATETIME(3) columns hold UTC; LocalDateTime avoids any driver or session time-zone conversion. */
    private static LocalDateTime utc(Instant t) {
        return t == null ? null : LocalDateTime.ofInstant(t, ZoneOffset.UTC);
    }
}
