package app.plateandbar.api.account;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Append-only record of erased accounts that lives outside the database, so a backup restore can erase them again
 * (#850, DPDP). One line per erasure: the opaque user id, a tab, the UTC time. Nothing else is ever written: no
 * email, no name, no content. The file sits on a dedicated volume that backup.sh uploads to a prefix that retention
 * never prunes. With no path configured the ledger is off and {@link #record} does nothing.
 */
@Component
public class ErasureLedger {

    /** User ids are UUIDs; anything else must not reach the file (it also keeps a line to one line). */
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F-]{1,64}");

    private final Path file;

    ErasureLedger(@Value("${app.erasure-ledger.path:}") String path) {
        this.file = path == null || path.isBlank() ? null : Path.of(path);
    }

    /**
     * Appends one entry and forces it to disk before returning.
     *
     * @throws ErasureLedgerException if it cannot be written; the caller must then not delete anything
     */
    public void record(String userId, Instant at) {
        if (file == null) {
            return;
        }
        if (userId == null || !ID.matcher(userId).matches()) {
            throw new ErasureLedgerException("user id is not an opaque id", null);
        }
        byte[] line = (userId + "\t" + DateTimeFormatter.ISO_INSTANT.format(at) + "\n").getBytes(StandardCharsets.UTF_8);
        try {
            Path dir = file.toAbsolutePath().getParent();
            if (dir != null) {
                Files.createDirectories(dir);
            }
            try (FileChannel ch = FileChannel.open(file, StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
                ByteBuffer buf = ByteBuffer.wrap(line);
                while (buf.hasRemaining()) {
                    ch.write(buf);
                }
                ch.force(true);
            }
        } catch (IOException e) {
            throw new ErasureLedgerException("erasure ledger not writable", e);
        }
    }
}
