package app.plateandbar.api.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ErasureLedgerTest {

    static final String A = "11111111-1111-1111-1111-111111111111";
    static final String B = "22222222-2222-2222-2222-222222222222";
    static final Instant AT = Instant.parse("2026-10-18T10:15:30Z");

    @TempDir Path dir;

    @Test
    void writesOneLineWithTheIdAndTheTimeAndNothingElse() throws Exception {
        Path f = dir.resolve("ledger/erasures.log");
        new ErasureLedger(f.toString(), false).record(A, AT);
        assertThat(Files.readString(f)).isEqualTo(A + "\t2026-10-18T10:15:30Z\n");
    }

    @Test
    void appendsAndNeverRewritesEarlierEntries() throws Exception {
        Path f = dir.resolve("erasures.log");
        ErasureLedger ledger = new ErasureLedger(f.toString(), false);
        ledger.record(A, AT);
        ledger.record(B, AT.plusSeconds(1));
        assertThat(Files.readAllLines(f))
                .isEqualTo(List.of(A + "\t2026-10-18T10:15:30Z", B + "\t2026-10-18T10:15:31Z"));
    }

    @Test
    void isOffWithoutAPath() {
        new ErasureLedger("", true).record(A, AT);
        new ErasureLedger(null, true).record(A, AT);
        assertThat(dir).isEmptyDirectory();
    }

    @Test
    void anEmptyPathRefusesToStartOutsideDevAndWarnsInDev() {
        for (String empty : new String[] {"", "  ", null}) {
            assertThatThrownBy(() -> new ErasureLedger(empty, false))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("ERASURE_LEDGER_PATH");
        }
        new ErasureLedger("", true); // dev: starts (and logs a WARN)
    }

    @Test
    void anUnwritableLedgerFailsInsteadOfSilentlyDropping() throws Exception {
        Path f = dir.resolve("erasures.log");
        Files.createDirectory(f); // a directory cannot be opened for appending
        assertThatThrownBy(() -> new ErasureLedger(f.toString(), false).record(A, AT)).isInstanceOf(ErasureLedgerException.class);
    }

    @Test
    void theFileIsOwnerOnlyAndSoIsTheDirectoryItCreates() throws Exception {
        Path f = dir.resolve("ledger/erasures.log");
        new ErasureLedger(f.toString(), false).record(A, AT);
        assertThat(Files.getPosixFilePermissions(f)).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        assertThat(Files.getPosixFilePermissions(f.getParent())).isEqualTo(PosixFilePermissions.fromString("rwx------"));
    }

    @Test
    void theTimeIsTruncatedToWholeSeconds() throws Exception {
        Path f = dir.resolve("erasures.log");
        new ErasureLedger(f.toString(), false).record(A, Instant.parse("2026-10-18T10:15:30.123456Z"));
        assertThat(Files.readString(f)).isEqualTo(A + "\t2026-10-18T10:15:30Z\n");
    }

    @Test
    void onlyAStrictLowerCaseUuidIsWritten() throws Exception {
        Path f = dir.resolve("erasures.log");
        ErasureLedger ledger = new ErasureLedger(f.toString(), false);
        for (String bad : new String[] {"-", "abc", "---", "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", A + "0", A.substring(1), A.replace('-', '_')}) {
            assertThatThrownBy(() -> ledger.record(bad, AT)).isInstanceOf(ErasureLedgerException.class);
        }
        assertThat(f).doesNotExist();
    }

    @Test
    void aLineCutShortByAFailedWriteDoesNotSwallowTheNextEntry() throws Exception {
        Path f = dir.resolve("erasures.log");
        Files.writeString(f, A + "\t2026-10-18T10:1"); // what ENOSPC or EIO can leave behind: no trailing newline
        new ErasureLedger(f.toString(), false).record(B, AT);
        assertThat(Files.readAllLines(f)).isEqualTo(List.of(A + "\t2026-10-18T10:1", B + "\t2026-10-18T10:15:30Z"));
    }

    @Test
    void refusesAnythingThatIsNotAnOpaqueId() throws Exception {
        Path f = dir.resolve("erasures.log");
        ErasureLedger ledger = new ErasureLedger(f.toString(), false);
        for (String bad : new String[] {"a@example.com", A + "\nforged", "x y", "", null}) {
            assertThatThrownBy(() -> ledger.record(bad, AT)).isInstanceOf(ErasureLedgerException.class);
        }
        assertThat(f).doesNotExist();
    }
}
