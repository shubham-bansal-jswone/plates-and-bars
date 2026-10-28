package app.plateandbar.api.sync;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
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

    /** The user's bookkeeping row: the last change number and the number of stored rows over all 16 tables. */
    record State(long seq, long records) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    SyncRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * Share-locks the user's row until the transaction ends, so a concurrent DELETE /me waits for this sync
     * (and a sync that starts after the delete committed finds no row). False when the user is gone.
     */
    boolean lockUser(String userId) {
        return !jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR SHARE", String.class, userId).isEmpty();
    }

    /**
     * Locks the user's bookkeeping row until the transaction ends (creating it on the first sync) and
     * returns the current change number and stored record count. The upsert takes the row's exclusive lock straight away, so two
     * first syncs of one user queue instead of deadlocking on a shared-to-exclusive upgrade. Throws a
     * {@link org.springframework.dao.DataIntegrityViolationException} (foreign key) when the user does not exist.
     */
    State lockState(String userId) {
        jdbc.update("INSERT INTO sync_state (user_id, seq) VALUES (?, 0) ON DUPLICATE KEY UPDATE seq = seq", userId);
        return jdbc.queryForObject(
                "SELECT seq, records FROM sync_state WHERE user_id = ? FOR UPDATE",
                (rs, n) -> new State(rs.getLong("seq"), rs.getLong("records")),
                userId);
    }

    void saveState(String userId, State state) {
        jdbc.update(
                "UPDATE sync_state SET seq = ?, records = ? WHERE user_id = ?", state.seq(), state.records(), userId);
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

    /** Rows of the table that are not tombstones, for this user only. */
    long countLive(SyncTable table, String userId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + table.sqlName() + " WHERE user_id = ? AND deleted_at IS NULL", Long.class, userId);
        return n == null ? 0 : n;
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

    /**
     * Bounds the user's conflict log: drops entries logged before {@code oldest}, then everything but the newest
     * {@code keep}. The ids are read first (a plain consistent read through the user's index, FORCE INDEX so the scan
     * stays inside this user's range) and then deleted by primary key, so the delete locks only the rows it removes
     * and never another user's.
     */
    void pruneConflicts(String userId, Instant oldest, int keep) {
        // The first prune of a user with a huge pre-existing log reads all their ids into memory; bounded by the cap after that.
        LocalDateTime cutoff = utc(oldest);
        List<Long> drop = new java.util.ArrayList<>();
        int[] position = {0};
        jdbc.query(
                "SELECT id, logged_at FROM sync_conflicts FORCE INDEX (ix_sync_conflicts_user_record)"
                        + " WHERE user_id = ? ORDER BY id DESC",
                rs -> {
                    boolean tooOld = rs.getObject("logged_at", LocalDateTime.class).isBefore(cutoff);
                    if (position[0]++ >= keep || tooOld) {
                        drop.add(rs.getLong("id"));
                    }
                },
                userId);
        for (int i = 0; i < drop.size(); i += 500) {
            List<Long> chunk = drop.subList(i, Math.min(drop.size(), i + 500));
            jdbc.update(
                    "DELETE FROM sync_conflicts WHERE user_id = ? AND id IN ("
                            + String.join(",", java.util.Collections.nCopies(chunk.size(), "?")) + ")",
                    java.util.stream.Stream.concat(java.util.stream.Stream.of((Object) userId), chunk.stream()).toArray());
        }
    }

    /** A logged conflict; {@code losing} carries the losing copy's version, updated_at, deleted_at and data. */
    record Conflict(long id, String table, String recordId, String loser, int winnerVersion, Instant loggedAt, Stored losing) {}

    /**
     * At most {@code limit} rows of the table for the user, tombstones included, oldest change first (seq, then id), starting after the row
     * {@code (afterSeq, afterId)} (keyset paging on the {@code (user_id, seq)} index, so no OFFSET scan). Pass
     * {@code null} for {@code afterId} to start at the beginning.
     */
    List<Stored> page(SyncTable table, String userId, long afterSeq, String afterId, int limit) {
        String cols = "SELECT id, version, updated_at, deleted_at, seq, data FROM " + table.sqlName();
        if (afterId == null) {
            return jdbc.query(cols + " WHERE user_id = ? ORDER BY seq, id LIMIT ?", (rs, n) -> map(rs), userId, limit);
        }
        return jdbc.query(
                cols + " WHERE user_id = ? AND (seq > ? OR (seq = ? AND id > ?)) ORDER BY seq, id LIMIT ?",
                (rs, n) -> map(rs),
                userId,
                afterSeq,
                afterSeq,
                afterId,
                limit);
    }

    /** At most {@code limit} conflict-log rows after row id {@code afterId} (0 for the first page), oldest first. */
    List<Conflict> conflictsPage(String userId, long afterId, int limit) {
        return jdbc.query(
                "SELECT id, table_name, record_id, loser, version, winner_version, updated_at, deleted_at, record,"
                        + " logged_at FROM sync_conflicts WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?",
                (rs, n) -> {
                    try {
                        LocalDateTime deleted = rs.getObject("deleted_at", LocalDateTime.class);
                        Stored losing = new Stored(
                                rs.getString("record_id"),
                                rs.getInt("version"),
                                rs.getObject("updated_at", LocalDateTime.class).toInstant(ZoneOffset.UTC),
                                deleted == null ? null : deleted.toInstant(ZoneOffset.UTC),
                                0,
                                json.readTree(rs.getString("record")));
                        return new Conflict(
                                rs.getLong("id"),
                                rs.getString("table_name"),
                                rs.getString("record_id"),
                                rs.getString("loser"),
                                rs.getInt("winner_version"),
                                rs.getObject("logged_at", LocalDateTime.class).toInstant(ZoneOffset.UTC),
                                losing);
                    } catch (JacksonException e) {
                        throw new IllegalStateException("stored record is not valid JSON", e);
                    }
                },
                userId,
                afterId,
                limit);
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
        } catch (JacksonException e) {
            throw new IllegalStateException("stored record is not valid JSON", e);
        }
    }

    private String text(JsonNode data) {
        try {
            return json.writeValueAsString(data);
        } catch (JacksonException e) {
            throw new IllegalStateException(e);
        }
    }

    /** DATETIME(3) columns hold UTC; LocalDateTime avoids any driver or session time-zone conversion. */
    private static LocalDateTime utc(Instant t) {
        return t == null ? null : LocalDateTime.ofInstant(t, ZoneOffset.UTC);
    }
}
