package app.plateandbar.api.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.List;
import java.util.TimeZone;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ErasureLedgerTest {

    static final String A = "11111111-1111-1111-1111-111111111111";
    static final String B = "22222222-2222-2222-2222-222222222222";
    static final Instant AT = Instant.parse("2026-10-18T10:15:30Z");
    static final String DAY = "erasures-2026-10-18.log";

    @TempDir Path dir;

    @Test
    void writesOneLineWithTheIdAndTheTimeAndNothingElse() throws Exception {
        Path d = dir.resolve("ledger");
        new ErasureLedger(d.toString(), false).record(A, AT);
        assertThat(Files.readString(d.resolve(DAY))).isEqualTo(A + "\t2026-10-18T10:15:30Z\n");
        try (var files = Files.list(d)) {
            assertThat(files).containsExactly(d.resolve(DAY));
        }
    }

    @Test
    void appendsAndNeverRewritesEarlierEntries() throws Exception {
        ErasureLedger ledger = new ErasureLedger(dir.toString(), false);
        ledger.record(A, AT);
        ledger.record(B, AT.plusSeconds(1));
        assertThat(Files.readAllLines(dir.resolve(DAY)))
                .isEqualTo(List.of(A + "\t2026-10-18T10:15:30Z", B + "\t2026-10-18T10:15:31Z"));
    }

    @Test
    void eachUtcDayHasItsOwnFileAndTheDayRollsOverAtUtcMidnight() throws Exception {
        ErasureLedger ledger = new ErasureLedger(dir.toString(), false);
        ledger.record(A, Instant.parse("2026-10-18T23:59:59.999Z")); // cut to 23:59:59: still the 18th
        ledger.record(B, Instant.parse("2026-10-19T00:00:00Z"));
        ledger.record(A, Instant.parse("2026-10-19T00:00:01Z"));
        assertThat(Files.readAllLines(dir.resolve("erasures-2026-10-18.log")))
                .isEqualTo(List.of(A + "\t2026-10-18T23:59:59Z"));
        assertThat(Files.readAllLines(dir.resolve("erasures-2026-10-19.log")))
                .isEqualTo(List.of(B + "\t2026-10-19T00:00:00Z", A + "\t2026-10-19T00:00:01Z"));
        try (var files = Files.list(dir)) {
            assertThat(files).hasSize(2);
        }
    }

    @Test
    void theDayIsTheUtcDayWhateverTheJvmTimeZone() throws Exception {
        TimeZone before = TimeZone.getDefault();
        try {
            // 20:00 UTC is already the next day in India and still the day before in Los Angeles at 03:00 UTC
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Kolkata"));
            new ErasureLedger(dir.toString(), false).record(A, Instant.parse("2026-10-18T20:00:00Z"));
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
            new ErasureLedger(dir.toString(), false).record(B, Instant.parse("2026-10-19T03:00:00Z"));
        } finally {
            TimeZone.setDefault(before);
        }
        assertThat(Files.readAllLines(dir.resolve("erasures-2026-10-18.log"))).containsExactly(A + "\t2026-10-18T20:00:00Z");
        assertThat(Files.readAllLines(dir.resolve("erasures-2026-10-19.log"))).containsExactly(B + "\t2026-10-19T03:00:00Z");
    }

    @Test
    void aSecondEntryOfANewDayWaitsUntilTheFirstHasSyncedTheDirectory() throws Exception {
        CountDownLatch inSync = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ErasureLedger ledger = new ErasureLedger(dir.toString(), false) {
            @Override
            void syncDirectory() throws java.io.IOException {
                inSync.countDown();
                try {
                    release.await(10, TimeUnit.SECONDS); // the first entry is still making the new file durable
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                super.syncDirectory();
            }
        };
        Thread first = new Thread(() -> ledger.record(A, AT));
        first.start();
        assertThat(inSync.await(10, TimeUnit.SECONDS)).isTrue();
        // the file exists now, so the second entry would skip the directory sync: it must wait for the first instead
        Thread second = new Thread(() -> ledger.record(B, AT.plusSeconds(1)));
        second.start();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (second.getState() != Thread.State.BLOCKED && second.isAlive() && System.nanoTime() < deadline) {
            Thread.sleep(5);
        }
        assertThat(second.getState()).isEqualTo(Thread.State.BLOCKED);
        release.countDown();
        first.join(10_000);
        second.join(10_000);
        assertThat(Files.readAllLines(dir.resolve(DAY)))
                .isEqualTo(List.of(A + "\t2026-10-18T10:15:30Z", B + "\t2026-10-18T10:15:31Z"));
    }

    @Test
    void neverWritesTheOldSingleFile() throws Exception {
        // #887: an erasures.log left by the single-file ledger (#854) is split into day files by ledger-upload.sh
        Files.writeString(dir.resolve("erasures.log"), A + "\t2026-10-17T09:00:00Z\n");
        new ErasureLedger(dir.toString(), false).record(B, AT);
        assertThat(Files.readString(dir.resolve("erasures.log"))).isEqualTo(A + "\t2026-10-17T09:00:00Z\n");
        assertThat(Files.readAllLines(dir.resolve(DAY))).containsExactly(B + "\t2026-10-18T10:15:30Z");
    }

    @Test
    void isOffWithoutADirectory() {
        new ErasureLedger("", true).record(A, AT);
        new ErasureLedger(null, true).record(A, AT);
        assertThat(dir).isEmptyDirectory();
    }

    @Test
    void anEmptyDirectoryRefusesToStartOutsideDevAndWarnsInDev() {
        for (String empty : new String[] {"", "  ", null}) {
            assertThatThrownBy(() -> new ErasureLedger(empty, false))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("ERASURE_LEDGER_DIR");
        }
        new ErasureLedger("", true); // dev: starts (and logs a WARN)
    }

    @Test
    void anUnwritableLedgerFailsInsteadOfSilentlyDropping() throws Exception {
        Files.createDirectory(dir.resolve(DAY)); // a directory cannot be opened for appending
        assertThatThrownBy(() -> new ErasureLedger(dir.toString(), false).record(A, AT)).isInstanceOf(ErasureLedgerException.class);
    }

    @Test
    void aDirectorySettingThatIsAFileFails() throws Exception {
        Path f = dir.resolve("erasures.log"); // the old setting pointed at a file
        Files.writeString(f, "");
        assertThatThrownBy(() -> new ErasureLedger(f.toString(), false).record(A, AT)).isInstanceOf(ErasureLedgerException.class);
    }

    @Test
    void theFileIsOwnerOnlyAndSoIsTheDirectoryItCreates() throws Exception {
        Path d = dir.resolve("ledger");
        new ErasureLedger(d.toString(), false).record(A, AT);
        assertThat(Files.getPosixFilePermissions(d.resolve(DAY))).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        assertThat(Files.getPosixFilePermissions(d)).isEqualTo(PosixFilePermissions.fromString("rwx------"));
    }

    @Test
    void theTimeIsTruncatedToWholeSeconds() throws Exception {
        new ErasureLedger(dir.toString(), false).record(A, Instant.parse("2026-10-18T10:15:30.123456Z"));
        assertThat(Files.readString(dir.resolve(DAY))).isEqualTo(A + "\t2026-10-18T10:15:30Z\n");
    }

    @Test
    void onlyAStrictLowerCaseUuidIsWritten() throws Exception {
        ErasureLedger ledger = new ErasureLedger(dir.toString(), false);
        for (String bad : new String[] {"-", "abc", "---", "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", A + "0", A.substring(1), A.replace('-', '_')}) {
            assertThatThrownBy(() -> ledger.record(bad, AT)).isInstanceOf(ErasureLedgerException.class);
        }
        assertThat(dir).isEmptyDirectory();
    }

    @Test
    void aLineCutShortByAFailedWriteDoesNotSwallowTheNextEntry() throws Exception {
        Path f = dir.resolve(DAY);
        Files.writeString(f, A + "\t2026-10-18T10:1"); // what ENOSPC or EIO can leave behind: no trailing newline
        new ErasureLedger(dir.toString(), false).record(B, AT);
        assertThat(Files.readAllLines(f)).isEqualTo(List.of(A + "\t2026-10-18T10:1", B + "\t2026-10-18T10:15:30Z"));
    }

    @Test
    void refusesAnythingThatIsNotAnOpaqueId() throws Exception {
        ErasureLedger ledger = new ErasureLedger(dir.toString(), false);
        for (String bad : new String[] {"a@example.com", A + "\nforged", "x y", "", null}) {
            assertThatThrownBy(() -> ledger.record(bad, AT)).isInstanceOf(ErasureLedgerException.class);
        }
        assertThat(dir).isEmptyDirectory();
    }
}
