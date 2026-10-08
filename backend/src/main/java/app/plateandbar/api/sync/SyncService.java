package app.plateandbar.api.sync;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import app.plateandbar.api.sync.SyncRepository.Stored;
import app.plateandbar.api.sync.SyncRequestValidator.Incoming;
import app.plateandbar.api.sync.SyncRequestValidator.Parsed;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One sync round trip (ADR 001): apply the pushed records, then pull what changed. Everything runs in
 * one transaction holding the user's {@code sync_state} lock, so two devices of one user sync one after
 * the other. Rules, per pushed record with the version {@code v} the device last saw:
 * <ul>
 *   <li>no stored record: stored as version 1 (a record the server never saw is new whatever {@code v} says);
 *   <li>{@code v} equals the stored version: stored as version + 1;
 *   <li>otherwise a conflict. If the content apart from version and updated_at equals the stored record it is
 *       a retry of an earlier success: {@code server_won}, nothing written, nothing logged. Else the later
 *       {@code updated_at} wins, a tie goes to the server, and the losing copy goes to {@code sync_conflicts}.
 * </ul>
 * Never log record contents: nothing here logs at all.
 */
@Service
public class SyncService {

    static final Duration FUTURE_SLACK = Duration.ofMinutes(5);

    private final SyncRepository repo;
    private final Clock clock;
    private final ObjectMapper json;

    SyncService(SyncRepository repo, Clock clock, ObjectMapper json) {
        this.repo = repo;
        this.clock = clock;
        this.json = json;
    }

    private record Pulled(SyncTable table, Stored record) {}

    @Transactional
    public ObjectNode sync(String userId, Parsed req) {
        Long locked = repo.lockState(userId);
        if (locked == null) {
            throw ApiException.sessionEnded(); // valid token, but the account no longer exists
        }
        long before = locked;
        long after = 0;
        if (req.cursor() != null) {
            after = Cursor.parse(req.cursor()).orElseThrow();
            if (after > before) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "invalid_request",
                        "The request is not valid.",
                        List.of(new ErrorResponse.Detail("cursor", "unknown")));
            }
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        long seq = before;
        ArrayNode applied = json.createArrayNode();
        ArrayNode conflicts = json.createArrayNode();
        Map<SyncTable, Set<String>> pushed = new EnumMap<>(SyncTable.class);

        Map<SyncTable, List<Incoming>> byTable = new LinkedHashMap<>();
        for (Incoming in : req.records()) {
            byTable.computeIfAbsent(in.table(), t -> new ArrayList<>()).add(in);
        }
        for (Map.Entry<SyncTable, List<Incoming>> e : byTable.entrySet()) {
            SyncTable table = e.getKey();
            Map<String, Stored> existing = repo.find(
                    table, userId, e.getValue().stream().map(Incoming::id).toList());
            Set<String> ids = pushed.computeIfAbsent(table, t -> new HashSet<>());
            for (Incoming in : e.getValue()) {
                ids.add(in.id());
                Instant updatedAt = clamp(in.updatedAt(), now);
                Instant deletedAt = in.deletedAt() == null ? null : clamp(in.deletedAt(), now);
                Stored stored = existing.get(in.id());

                if (stored == null || stored.version() == in.version()) {
                    seq++;
                    int version = stored == null ? 1 : stored.version() + 1;
                    Stored next = new Stored(in.id(), version, updatedAt, deletedAt, seq, in.data());
                    if (stored == null) {
                        repo.insert(table, userId, next);
                    } else {
                        repo.update(table, userId, next);
                    }
                    applied.add(json.createObjectNode()
                            .put("table", table.name())
                            .put("id", in.id())
                            .put("version", version));
                    continue;
                }

                Stored incoming = new Stored(in.id(), in.version(), updatedAt, deletedAt, 0, in.data());
                if (isRetry(incoming, stored)) {
                    conflicts.add(conflict(table, in, stored, "server_won"));
                } else if (updatedAt.isAfter(stored.updatedAt())) {
                    seq++;
                    Stored next = new Stored(in.id(), stored.version() + 1, updatedAt, deletedAt, seq, in.data());
                    repo.update(table, userId, next);
                    repo.logConflict(userId, table, "server", next.version(), stored, now);
                    conflicts.add(conflict(table, in, next, "client_won"));
                } else {
                    repo.logConflict(userId, table, "client", stored.version(), incoming, now);
                    conflicts.add(conflict(table, in, stored, "server_won"));
                }
            }
        }
        if (seq != before) {
            repo.saveSeq(userId, seq);
        }

        // Pull: everything stored before this request's writes, minus the records the device just pushed.
        List<Pulled> pulled = new ArrayList<>();
        for (SyncTable table : SyncTable.values()) {
            Set<String> own = pushed.getOrDefault(table, Set.of());
            // Up to 501 survive the filter, so ask for 501 plus the pushed ids that may be filtered out.
            for (Stored s : repo.changedSince(
                    table, userId, after, before, req.cursor() != null, SyncRequestValidator.MAX_RECORDS + 1 + own.size())) {
                if (!own.contains(s.id())) {
                    pulled.add(new Pulled(table, s));
                }
            }
        }
        pulled.sort(Comparator.comparingLong(p -> p.record().seq()));
        boolean hasMore = pulled.size() > SyncRequestValidator.MAX_RECORDS;
        List<Pulled> page = hasMore ? pulled.subList(0, SyncRequestValidator.MAX_RECORDS) : pulled;
        long cursor = hasMore ? page.get(page.size() - 1).record().seq() : seq;

        ObjectNode changes = json.createObjectNode();
        for (Pulled p : page) {
            ((ArrayNode) changes.withArray(p.table().name())).add(record(p.record()));
        }

        ObjectNode out = json.createObjectNode();
        out.put("cursor", Cursor.format(cursor));
        out.put("has_more", hasMore);
        out.set("applied", applied);
        out.set("conflicts", conflicts);
        out.set("changes", changes);
        return out;
    }

    /** Same content apart from version and updated_at: a device re-sending a push that already succeeded. */
    private static boolean isRetry(Stored incoming, Stored stored) {
        return (incoming.deletedAt() == null) == (stored.deletedAt() == null)
                && JsonContent.same(incoming.data(), stored.data());
    }

    private static Instant clamp(Instant t, Instant now) {
        Instant t3 = t.truncatedTo(ChronoUnit.MILLIS);
        return t3.isAfter(now.plus(FUTURE_SLACK)) ? now : t3;
    }

    private ObjectNode conflict(SyncTable table, Incoming in, Stored server, String resolution) {
        ObjectNode c = json.createObjectNode();
        c.put("table", table.name());
        c.put("id", in.id());
        c.put("client_version", in.version());
        c.put("server_version", server.version());
        c.put("resolution", resolution);
        c.set("server_record", record(server));
        return c;
    }

    private ObjectNode record(Stored s) {
        ObjectNode r = json.createObjectNode();
        r.put("id", s.id());
        r.put("version", s.version());
        r.put("updated_at", DateTimeFormatter.ISO_INSTANT.format(s.updatedAt()));
        if (s.deletedAt() == null) {
            r.putNull("deleted_at");
        } else {
            r.put("deleted_at", DateTimeFormatter.ISO_INSTANT.format(s.deletedAt()));
        }
        r.setAll((ObjectNode) s.data());
        return r;
    }
}
