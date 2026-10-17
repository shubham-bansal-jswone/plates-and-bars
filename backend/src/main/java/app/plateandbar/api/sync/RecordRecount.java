package app.plateandbar.api.sync;

import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Recounts {@code sync_state.records} from the 16 tables (#667), so the per-account cap (#349) starts from true numbers.
 * Runs in the background once at start whenever the cap is on (so also after the limit is changed, which needs a restart),
 * and is idempotent: a counter that is already right is not written.
 * <p>
 * Safe beside live pushes: users are taken in batches by key, and each user is its own short transaction that first takes
 * the same {@code FOR UPDATE} lock on the user's {@code sync_state} row that a sync holds, then counts, then writes. A push
 * of that user either finished before (its rows are counted) or waits for the recount (its increment lands on the new
 * number), so none is lost, and no lock is held for more than one user's 16 indexed counts.
 * <p>
 * Never logs user data: only the numbers of users checked and corrected.
 */
@Component
class RecordRecount {

    private static final Logger log = LoggerFactory.getLogger(RecordRecount.class);

    static final int BATCH = 200;

    private static final String COUNT_SQL = java.util.Arrays.stream(SyncTable.values())
            .map(t -> "(SELECT COUNT(*) FROM " + t.sqlName() + " WHERE user_id = ?)")
            .collect(Collectors.joining(" + ", "SELECT ", ""));

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final boolean capOn;

    RecordRecount(
            JdbcTemplate jdbc,
            TransactionTemplate tx,
            @Value("${app.sync.max-records-per-account:}") String maxRecords) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.capOn = SyncService.parseCap(maxRecords) > 0;
    }

    @EventListener(ApplicationReadyEvent.class)
    void runAtStart() {
        if (!capOn) {
            return;
        }
        Thread t = new Thread(() -> {
            try {
                long fixed = recountAll();
                log.info("record recount done, counters corrected: {}", fixed);
            } catch (RuntimeException e) {
                log.error("record recount failed: {}", e.getClass().getSimpleName()); // safe to rerun: restart the app
            }
        }, "record-recount");
        t.setDaemon(true);
        t.start();
    }

    /** Recounts every user with a {@code sync_state} row; returns how many counters were wrong and are now corrected. */
    long recountAll() {
        long corrected = 0;
        long checked = 0;
        String after = "";
        while (true) {
            List<String> users = jdbc.queryForList(
                    "SELECT user_id FROM sync_state WHERE user_id > ? ORDER BY user_id LIMIT ?", String.class, after, BATCH);
            if (users.isEmpty()) {
                break;
            }
            for (String user : users) {
                if (recount(user)) {
                    corrected++;
                }
                checked++;
            }
            after = users.get(users.size() - 1);
        }
        log.info("record recount checked {} accounts", checked);
        return corrected;
    }

    /** One user, one short transaction. True when the stored counter was wrong. */
    boolean recount(String userId) {
        return Boolean.TRUE.equals(tx.execute(status -> {
            List<Long> stored = jdbc.queryForList(
                    "SELECT records FROM sync_state WHERE user_id = ? FOR UPDATE", Long.class, userId);
            if (stored.isEmpty()) {
                return false; // the account was deleted meanwhile
            }
            // The snapshot of these counts is taken after the lock above is held, so it includes every committed push.
            Object[] args = new Object[SyncTable.values().length];
            java.util.Arrays.fill(args, userId);
            Long actual = jdbc.queryForObject(COUNT_SQL, Long.class, args);
            if (actual == null || actual.equals(stored.get(0))) {
                return false;
            }
            jdbc.update("UPDATE sync_state SET records = ? WHERE user_id = ?", actual, userId);
            return true;
        }));
    }
}
