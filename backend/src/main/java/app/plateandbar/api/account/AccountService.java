package app.plateandbar.api.account;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.sync.SyncExporter;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.StreamWriteFeature;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Export and deletion of one user's data. Logs that each happened (user id), never any content. */
@Service
public class AccountService {

    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    /** Matches {@code spring.mvc.async.request-timeout}: no export transaction outlives its response. */
    static final int EXPORT_TX_SECONDS = 600;

    private final AccountRepository accounts;
    private final SyncExporter sync;
    private final ObjectMapper json;
    private final Clock clock;
    private final ErasureLedger ledger;

    AccountService(
            AccountRepository accounts, SyncExporter sync, ObjectMapper json, Clock clock, ErasureLedger ledger) {
        this.accounts = accounts;
        this.sync = sync;
        this.json = json;
        this.clock = clock;
        this.ledger = ledger;
    }

    /** The account row, or 401 when it is gone. Checked before the response starts, while a status can still be sent. */
    public void requireAccount(String userId) {
        accounts.find(userId).orElseThrow(ApiException::unauthorized);
    }

    /**
     * Streams the export document to {@code out}. One consistent snapshot: a single read-only transaction (MySQL
     * InnoDB repeatable read) around every read, so the pages of every table agree with each other. Runs on the
     * thread that writes the response, so the transaction must start here and not in the controller.
     *
     * <p>Any failure propagates and leaves the document unfinished: the generator is configured not to close open
     * arrays and objects, so a truncated body is never repaired into valid-looking JSON (see {@code backend/README.md}).
     * Returns the number of bytes written.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = AccountService.EXPORT_TX_SECONDS)
    public long writeExport(String userId, Instant at, OutputStream out) throws IOException {
        AccountRepository.Account a = accounts.find(userId).orElseThrow(ApiException::unauthorized);
        CountingOutputStream counted = new CountingOutputStream(out);
        try (JsonGenerator g = json.writer().without(StreamWriteFeature.AUTO_CLOSE_CONTENT).createGenerator(counted)) {
            g.writeStartObject();
            g.writeNumberProperty("format_version", 1);
            g.writeStringProperty("exported_at", DateTimeFormatter.ISO_INSTANT.format(at));
            g.writeName("user");
            g.writeStartObject();
            g.writeStringProperty("id", a.id());
            if (a.email() == null) {
                g.writeNullProperty("email");
            } else {
                g.writeStringProperty("email", a.email());
            }
            g.writeStringProperty("created_at", DateTimeFormatter.ISO_INSTANT.format(a.createdAt()));
            g.writeEndObject();
            g.writeName("tables");
            sync.writeTables(userId, g);
            g.writeName("conflict_log");
            sync.writeConflictLog(userId, g);
            g.writeEndObject();
            g.flush();
        }
        return counted.count;
    }

    private static final class CountingOutputStream extends FilterOutputStream {
        long count;

        CountingOutputStream(OutputStream out) {
            super(out);
        }

        @Override
        public void write(int b) throws IOException {
            out.write(b);
            count++;
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            out.write(b, off, len);
            count += len;
        }
    }

    /**
     * Idempotent: deleting an account that is already gone succeeds. The erasure ledger is written first and fails
     * closed: if it cannot be written nothing is deleted and the call fails (500, the app retries), because the
     * other order could delete the rows and then lose the record a restore needs. The reverse failure (ledger
     * written, deletion rolled back) is harmless: the retry succeeds, and replaying a ledgered id that still
     * exists only deletes an account its owner asked to delete. A retry may append the same id twice; replay is
     * by id, so duplicates are harmless. Once the account row is gone the ledger is not appended to again.
     */
    @Transactional
    public void delete(String userId) {
        Instant at = clock.instant();
        // A repeat call (the access token outlives the account by up to 15 minutes) has nothing new to ledger.
        if (accounts.find(userId).isPresent()) {
            ledger.record(userId, at);
        }
        accounts.deleteAll(userId);
        log.info("Account deleted: user {} at {}", userId, at);
    }
}
