package app.plateandbar.api.account;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.format.DateTimeFormatter;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Append-only record of erased accounts that lives outside the database, so a backup restore can erase them again
 * (#850, DPDP). One line per erasure: the opaque user id, a tab, the UTC time. Nothing else is ever written: no
 * email, no name, no content. One file per UTC day, {@code erasures-YYYY-MM-DD.log} in the ledger directory (#887),
 * so the 45-day retention can delete whole days: infra's ledger-upload.sh copies each day file to its own bucket
 * object and deletes the day files older than 45 days. This class never deletes or rewrites a file. The directory
 * sits on a dedicated volume. With no directory configured (dev only) the ledger is off and {@link #record} does
 * nothing.
 */
@Component
public class ErasureLedger {

    private static final Logger log = LoggerFactory.getLogger(ErasureLedger.class);

    /**
     * The exact shape of a user id (a lower-case UUID, as {@code UUID.randomUUID().toString()} writes it). The replay
     * after a restore (#853) must use this same pattern: this writer never writes a line the replay would refuse, and
     * nothing else can reach the file (it also keeps a line to one line).
     */
    public static final Pattern ID =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private static final FileAttribute<Set<PosixFilePermission>> OWNER_FILE =
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"));
    private static final FileAttribute<Set<PosixFilePermission>> OWNER_DIR =
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------"));

    /** The UTC day of the entry names its file. */
    private static final DateTimeFormatter DAY = DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC);

    private final Path dir;
    private final boolean posix = FileSystems.getDefault().supportedFileAttributeViews().contains("posix");

    @Autowired
    ErasureLedger(@Value("${app.erasure-ledger.dir:}") String dir, Environment env) {
        this(dir, env.acceptsProfiles(Profiles.of("dev")));
    }

    /**
     * An empty directory turns the ledger off, which lets a backup restore bring back deleted accounts. Outside the
     * dev profile that is refused at startup (as {@code SmtpMailSender} refuses a missing SMTP host); in dev it is a
     * WARN.
     */
    ErasureLedger(String dir, boolean dev) {
        this.dir = dir == null || dir.isBlank() ? null : Path.of(dir).toAbsolutePath();
        if (this.dir == null) {
            if (!dev) {
                throw new IllegalStateException("ERASURE_LEDGER_DIR is required unless the dev profile is active");
            }
            log.warn("Erasure ledger off (ERASURE_LEDGER_DIR empty): a backup restore will bring back deleted accounts");
        }
    }

    /**
     * Appends one entry to the file of its UTC day ({@code erasures-yyyy-MM-dd.log}, the day of the time as written)
     * and forces it to disk before returning. The time is cut to whole seconds, so every line has the same fixed
     * width ({@code <uuid> TAB yyyy-MM-ddTHH:mm:ssZ}).
     *
     * <p>If an earlier write failed half way (ENOSPC, EIO) the file can end in a line with no newline. The next entry
     * then starts on a new line, so a good entry is never glued onto a cut-off one; the replay must skip a line that
     * does not match, and that line's user, if its id is cut, is re-ledgered by the retry (README, "Erasure ledger").
     *
     * <p>Synchronized: the first entry of a day creates the file and then syncs the directory. Without the lock a
     * second deletion racing it could see the file already there, skip the directory sync, and return (and delete)
     * before the new directory entry is durable. Deletions are rare, so serialising them costs nothing.
     *
     * @throws ErasureLedgerException if it cannot be written; the caller must then not delete anything
     */
    public synchronized void record(String userId, Instant at) {
        if (dir == null) {
            return;
        }
        if (userId == null || !ID.matcher(userId).matches()) {
            throw new ErasureLedgerException("user id is not an opaque id", null);
        }
        Instant time = at.truncatedTo(ChronoUnit.SECONDS);
        String entry = userId + "\t" + DateTimeFormatter.ISO_INSTANT.format(time) + "\n";
        Path file = dir.resolve("erasures-" + DAY.format(time) + ".log");
        try {
            if (posix) {
                Files.createDirectories(dir, OWNER_DIR);
            } else {
                Files.createDirectories(dir);
            }
            boolean created = !Files.exists(file);
            byte[] line = ((!created && endsMidLine(file) ? "\n" : "") + entry).getBytes(StandardCharsets.UTF_8);
            Set<StandardOpenOption> opts = Set.of(StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            try (FileChannel ch = posix ? FileChannel.open(file, opts, OWNER_FILE) : FileChannel.open(file, opts)) {
                ByteBuffer buf = ByteBuffer.wrap(line);
                while (buf.hasRemaining()) {
                    ch.write(buf);
                }
                // Real fsync. No test can observe it (the page cache answers reads either way); a mutation test that
                // removes this call survives. Keep it, and keep the line of reasoning in the README.
                ch.force(true);
            }
            if (created && posix) {
                syncDirectory();
            }
        } catch (IOException e) {
            throw new ErasureLedgerException("erasure ledger not writable", e);
        }
    }

    /** The new directory entry is not durable until the directory itself is synced. Package-private for a test. */
    void syncDirectory() throws IOException {
        try (FileChannel d = FileChannel.open(dir, StandardOpenOption.READ)) {
            d.force(true);
        }
    }

    private static boolean endsMidLine(Path file) throws IOException {
        try (SeekableByteChannel ch = Files.newByteChannel(file, StandardOpenOption.READ)) {
            long size = ch.size();
            if (size == 0) {
                return false;
            }
            ch.position(size - 1);
            ByteBuffer last = ByteBuffer.allocate(1);
            ch.read(last);
            return last.get(0) != '\n';
        }
    }
}
