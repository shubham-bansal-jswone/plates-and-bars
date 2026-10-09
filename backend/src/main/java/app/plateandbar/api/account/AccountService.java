package app.plateandbar.api.account;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.sync.SyncExporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Export and deletion of one user's data. Logs that each happened (user id), never any content. */
@Service
public class AccountService {

    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    private final AccountRepository accounts;
    private final SyncExporter sync;
    private final ObjectMapper json;
    private final Clock clock;

    AccountService(AccountRepository accounts, SyncExporter sync, ObjectMapper json, Clock clock) {
        this.accounts = accounts;
        this.sync = sync;
        this.json = json;
        this.clock = clock;
    }

    /** One consistent snapshot: a single read-only transaction. */
    @Transactional(readOnly = true)
    public ObjectNode export(String userId, Instant at) {
        AccountRepository.Account a = accounts.find(userId).orElseThrow(ApiException::unauthorized);
        ObjectNode out = json.createObjectNode();
        out.put("format_version", 1);
        out.put("exported_at", DateTimeFormatter.ISO_INSTANT.format(at));
        ObjectNode user = out.putObject("user");
        user.put("id", a.id());
        if (a.email() == null) {
            user.putNull("email");
        } else {
            user.put("email", a.email());
        }
        user.put("created_at", DateTimeFormatter.ISO_INSTANT.format(a.createdAt()));
        out.set("tables", sync.tables(userId));
        out.set("conflict_log", sync.conflictLog(userId));
        return out;
    }

    /** Idempotent: deleting an account that is already gone succeeds. */
    @Transactional
    public void delete(String userId) {
        accounts.deleteAll(userId);
        log.info("Account deleted: user {} at {}", userId, clock.instant());
    }
}
