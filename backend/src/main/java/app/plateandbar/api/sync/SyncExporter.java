package app.plateandbar.api.sync;

import java.time.format.DateTimeFormatter;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.ObjectMapper;

/**
 * Writes everything the sync engine stores for one user, for {@code GET /me/export}: every row of every
 * {@link SyncTable} (tombstones included) and the conflict log. Always scoped by the given user id.
 *
 * <p>Rows are read in pages of {@code app.export.page-size} (keyset paging) and written straight to the generator,
 * so memory is bounded by one page plus the generator's buffer, whatever the account holds. The caller must run
 * both methods in one read-only transaction so the pages come from one snapshot.
 */
@Component
public class SyncExporter {

    /** Rows per query. Small enough to be a trivial heap cost, large enough to be a handful of queries. */
    static final int DEFAULT_PAGE_SIZE = 500;

    private final SyncRepository repo;
    private final ObjectMapper json;
    private final int pageSize;

    SyncExporter(SyncRepository repo, ObjectMapper json, @Value("${app.export.page-size:500}") int pageSize) {
        if (pageSize < 1) {
            throw new IllegalArgumentException("app.export.page-size must be at least 1");
        }
        this.repo = repo;
        this.json = json;
        this.pageSize = pageSize;
    }

    /** The {@code tables} value: one array per table, in contract order, empty when the user has no rows. */
    public void writeTables(String userId, JsonGenerator out) {
        out.writeStartObject();
        for (SyncTable table : SyncTable.values()) {
            out.writeName(table.name());
            out.writeStartArray();
            long afterSeq = 0;
            String afterId = null;
            List<SyncRepository.Stored> page;
            do {
                page = repo.page(table, userId, afterSeq, afterId, pageSize);
                for (SyncRepository.Stored s : page) {
                    out.writeTree(SyncService.toRecord(json, s));
                }
                if (!page.isEmpty()) {
                    SyncRepository.Stored last = page.get(page.size() - 1);
                    afterSeq = last.seq();
                    afterId = last.id();
                }
            } while (page.size() == pageSize);
            out.writeEndArray();
        }
        out.writeEndObject();
    }

    /** The {@code conflict_log} value: losing copies, oldest first. */
    public void writeConflictLog(String userId, JsonGenerator out) {
        out.writeStartArray();
        long afterId = 0;
        List<SyncRepository.Conflict> page;
        do {
            page = repo.conflictsPage(userId, afterId, pageSize);
            for (SyncRepository.Conflict c : page) {
                out.writeStartObject();
                out.writeStringProperty("table", c.table());
                out.writeStringProperty("id", c.recordId());
                out.writeStringProperty("loser", c.loser());
                out.writeNumberProperty("winner_version", c.winnerVersion());
                out.writeStringProperty("logged_at", DateTimeFormatter.ISO_INSTANT.format(c.loggedAt()));
                out.writeName("record");
                out.writeTree(SyncService.toRecord(json, c.losing()));
                out.writeEndObject();
                afterId = c.id();
            }
        } while (page.size() == pageSize);
        out.writeEndArray();
    }
}
