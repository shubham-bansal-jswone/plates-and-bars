package app.plateandbar.api.sync;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import app.plateandbar.api.sync.SyncRepository.Stored;
import app.plateandbar.api.sync.SyncRequestValidator.Incoming;
import app.plateandbar.api.sync.SyncRequestValidator.Parsed;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 * Per-account record cap (#349, contract 0.1.16): when {@code app.sync.max-records-per-account} is set, a push with at
 * least one new record (an id the account does not store in that table) is refused whole with 413 {@code account_full}
 * if stored + new is over the limit. The stored count is {@code sync_state.records}, kept in step in this transaction.
 * <p>
 * Never log record contents: the only log line is the refusal, with the user id and three counts.
 */
@Service
public class SyncService {

    private static final Logger log = LoggerFactory.getLogger(SyncService.class);

    static final Duration FUTURE_SLACK = Duration.ofMinutes(5);

    private final SyncRepository repo;
    private final Clock clock;
    private final ObjectMapper json;

    /** The conflict log keeps at most this many entries per user, none older than the retention (M3). */
    private final int conflictLogKeep;

    private final Duration conflictLogRetention;

    /** Most records one account may store; 0 means no cap. */
    private final long maxRecords;

    SyncService(
            SyncRepository repo,
            Clock clock,
            ObjectMapper json,
            @org.springframework.beans.factory.annotation.Value("${app.sync.conflict-log-max-per-user:1000}") int conflictLogKeep,
            @org.springframework.beans.factory.annotation.Value("${app.sync.conflict-log-retention-days:90}") int retentionDays,
            @org.springframework.beans.factory.annotation.Value("${app.sync.max-records-per-account:}") String maxRecords) {
        if (conflictLogKeep < 1 || retentionDays < 1) {
            // 0 would delete the whole log, including the copy just written.
            throw new IllegalArgumentException(
                    "app.sync.conflict-log-max-per-user and app.sync.conflict-log-retention-days must both be at least 1");
        }
        this.maxRecords = parseCap(maxRecords);
        this.conflictLogKeep = conflictLogKeep;
        this.conflictLogRetention = Duration.ofDays(retentionDays);
        this.repo = repo;
        this.clock = clock;
        this.json = json;
    }

    /** Unset, blank or 0 is no cap; anything else must be a positive whole number or the app refuses to start. */
    private static long parseCap(String value) {
        if (value == null || value.isBlank()) {
            return 0;
        }
        try {
            long n = Long.parseLong(value.trim());
            if (n >= 0) {
                return n;
            }
        } catch (NumberFormatException e) {
            // falls through to the message below
        }
        throw new IllegalArgumentException("app.sync.max-records-per-account must be a whole number, 0 or more");
    }

    private record Pulled(SyncTable table, Stored record) {}

    @Transactional
    public ObjectNode sync(String userId, Parsed req) {
        if (!repo.lockUser(userId)) {
            throw ApiException.sessionEnded(); // valid token, but the account no longer exists
        }
        SyncRepository.State state;
        try {
            // Every read below happens after this lock, so each sees whatever the previous sync committed.
            state = repo.lockState(userId);
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw ApiException.sessionEnded(); // valid token, but the account no longer exists
        }
        long before = state.seq();
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

        Map<SyncTable, List<Incoming>> byTable = new LinkedHashMap<>();
        for (Incoming in : req.records()) {
            byTable.computeIfAbsent(in.table(), t -> new ArrayList<>()).add(in);
        }
        // What the account stores of the pushed ids, per table; an id missing here is new (whatever version was sent).
        Map<SyncTable, Map<String, Stored>> storedByTable = new EnumMap<>(SyncTable.class);
        long fresh = 0;
        for (Map.Entry<SyncTable, List<Incoming>> e : byTable.entrySet()) {
            Map<String, Stored> found = repo.find(
                    e.getKey(), userId, e.getValue().stream().map(Incoming::id).toList());
            storedByTable.put(e.getKey(), found);
            fresh += e.getValue().size() - found.size();
        }
        if (maxRecords > 0 && fresh > 0 && state.records() + fresh > maxRecords) {
            log.warn("Sync refused, account full: user {} limit {} stored {} new {}",
                    userId, maxRecords, state.records(), fresh);
            throw new AccountFullException(maxRecords, state.records(), fresh);
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        long seq = before;
        boolean logged = false;
        ArrayNode applied = json.createArrayNode();
        ArrayNode conflicts = json.createArrayNode();
        Map<SyncTable, Set<String>> pushed = new EnumMap<>(SyncTable.class);

        for (Map.Entry<SyncTable, List<Incoming>> e : byTable.entrySet()) {
            SyncTable table = e.getKey();
            Map<String, Stored> existing = storedByTable.get(table);
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
                if (isRetry(incoming, in.deletedAt(), stored, now)) {
                    conflicts.add(conflict(table, in, stored, "server_won"));
                } else if (updatedAt.isAfter(stored.updatedAt())) {
                    seq++;
                    Stored next = new Stored(in.id(), stored.version() + 1, updatedAt, deletedAt, seq, in.data());
                    repo.update(table, userId, next);
                    repo.logConflict(userId, table, "server", next.version(), stored, now);
                    logged = true;
                    conflicts.add(conflict(table, in, next, "client_won"));
                } else {
                    repo.logConflict(userId, table, "client", stored.version(), incoming, now);
                    logged = true;
                    conflicts.add(conflict(table, in, stored, "server_won"));
                }
            }
        }
        if (seq != before) {
            repo.saveState(userId, new SyncRepository.State(seq, state.records() + fresh));
        }
        if (logged) {
            repo.pruneConflicts(userId, now.minus(conflictLogRetention), conflictLogKeep);
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
            changes.withArrayProperty(p.table().name()).add(record(p.record()));
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
    private static boolean isRetry(Stored incoming, Instant rawDeletedAt, Stored stored, Instant now) {
        return sameDeletedAt(incoming.deletedAt(), rawDeletedAt, stored.deletedAt(), now)
                && JsonContent.same(incoming.data(), stored.data());
    }

    /**
     * Equal delete times, or both set when the sent time was in the future: the first attempt clamped it to
     * that moment's server time, so a retry cannot reproduce the stored value.
     */
    private static boolean sameDeletedAt(Instant clamped, Instant raw, Instant stored, Instant now) {
        if (clamped == null || stored == null) {
            return clamped == null && stored == null;
        }
        return clamped.equals(stored) || raw.isAfter(now.plus(FUTURE_SLACK));
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
        return toRecord(json, s);
    }

    /** The contract's record shape: meta fields plus the stored data. */
    static ObjectNode toRecord(ObjectMapper json, Stored s) {
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
