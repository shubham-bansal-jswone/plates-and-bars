package app.plateandbar.api.sync;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

/**
 * Reads everything the sync engine stores for one user, for {@code GET /me/export}: every row of every
 * {@link SyncTable} (tombstones included) and the conflict log. Always scoped by the given user id.
 */
@Component
public class SyncExporter {

    private final SyncRepository repo;
    private final ObjectMapper json;

    SyncExporter(SyncRepository repo, ObjectMapper json) {
        this.repo = repo;
        this.json = json;
    }

    /** One array per table, in contract order, empty when the user has no rows. */
    public ObjectNode tables(String userId) {
        ObjectNode out = json.createObjectNode();
        for (SyncTable table : SyncTable.values()) {
            ArrayNode rows = out.putArray(table.name());
            repo.all(table, userId).forEach(s -> rows.add(SyncService.toRecord(json, s)));
        }
        return out;
    }

    /** Losing copies, oldest first. */
    public ArrayNode conflictLog(String userId) {
        ArrayNode out = json.createArrayNode();
        for (SyncRepository.Conflict c : repo.conflicts(userId)) {
            ObjectNode e = out.addObject();
            e.put("table", c.table());
            e.put("id", c.recordId());
            e.put("loser", c.loser());
            e.put("winner_version", c.winnerVersion());
            e.put("logged_at", java.time.format.DateTimeFormatter.ISO_INSTANT.format(c.loggedAt()));
            JsonNode record = SyncService.toRecord(json, c.losing());
            e.set("record", record);
        }
        return out;
    }
}
