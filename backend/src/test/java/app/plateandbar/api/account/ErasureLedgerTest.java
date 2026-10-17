package app.plateandbar.api.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
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
        new ErasureLedger(f.toString()).record(A, AT);
        assertThat(Files.readString(f)).isEqualTo(A + "\t2026-10-18T10:15:30Z\n");
    }

    @Test
    void appendsAndNeverRewritesEarlierEntries() throws Exception {
        Path f = dir.resolve("erasures.log");
        ErasureLedger ledger = new ErasureLedger(f.toString());
        ledger.record(A, AT);
        ledger.record(B, AT.plusSeconds(1));
        assertThat(Files.readAllLines(f))
                .isEqualTo(List.of(A + "\t2026-10-18T10:15:30Z", B + "\t2026-10-18T10:15:31Z"));
    }

    @Test
    void isOffWithoutAPath() {
        new ErasureLedger("").record(A, AT);
        new ErasureLedger(null).record(A, AT);
        assertThat(dir).isEmptyDirectory();
    }

    @Test
    void anUnwritableLedgerFailsInsteadOfSilentlyDropping() throws Exception {
        Path f = dir.resolve("erasures.log");
        Files.createDirectory(f); // a directory cannot be opened for appending
        assertThatThrownBy(() -> new ErasureLedger(f.toString()).record(A, AT)).isInstanceOf(ErasureLedgerException.class);
    }

    @Test
    void refusesAnythingThatIsNotAnOpaqueId() throws Exception {
        Path f = dir.resolve("erasures.log");
        ErasureLedger ledger = new ErasureLedger(f.toString());
        for (String bad : new String[] {"a@example.com", A + "\nforged", "x y", "", null}) {
            assertThatThrownBy(() -> ledger.record(bad, AT)).isInstanceOf(ErasureLedgerException.class);
        }
        assertThat(f).doesNotExist();
    }
}
