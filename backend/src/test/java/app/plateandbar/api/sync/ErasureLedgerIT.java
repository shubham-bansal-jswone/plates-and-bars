package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** DELETE /me and the erasure ledger (#850, #887) on real MySQL and real files. Lives in the sync package for its fixtures. */
class ErasureLedgerIT extends SyncITBase {

    static final Path DIR = tempLedgerDir();
    /** The day file of START (2026-10-08T12:00:00Z, the test clock). */
    static final Path LEDGER = DIR.resolve("erasures-2026-10-08.log");

    private static Path tempLedgerDir() {
        try {
            return Files.createTempDirectory("ledger-it");
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void ledger(DynamicPropertyRegistry r) {
        r.add("app.erasure-ledger.dir", DIR::toString);
    }

    @BeforeEach
    void emptyLedger() throws Exception {
        try (Stream<Path> files = Files.list(DIR)) {
            for (Path f : files.toList()) {
                Files.delete(f); // day files, and the directory the failure test puts in place of one
            }
        }
    }

    private int delete(String user) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(jwt.issue(user).value());
        ResponseEntity<String> r = http.exchange("/api/v1/me", HttpMethod.DELETE, new HttpEntity<>(h), String.class);
        return r.getStatusCode().value();
    }

    @Test
    void deleteWritesExactlyOneEntryWithOnlyTheIdAndTheTime() throws Exception {
        String a = newUser();
        String b = newUser();
        assertThat(delete(a)).isEqualTo(204);

        List<String> lines = Files.readAllLines(LEDGER);
        assertThat(lines).hasSize(1);
        assertThat(lines.get(0)).isEqualTo(a + "\t2026-10-08T12:00:00Z");
        assertThat(Files.readString(LEDGER)).doesNotContain("@").doesNotContain(b);
        assertThat(count("SELECT COUNT(*) FROM users WHERE id = ?", a)).isZero();
    }

    @Test
    void aLedgerThatCannotBeWrittenDeletesNothingAndAnswers500() throws Exception {
        String a = newUser();
        Files.createDirectory(LEDGER); // appending to a directory fails

        assertThat(delete(a)).isEqualTo(500);
        assertThat(count("SELECT COUNT(*) FROM users WHERE id = ?", a)).isEqualTo(1);

        Files.delete(LEDGER); // the volume is back: the app's retry succeeds
        assertThat(delete(a)).isEqualTo(204);
        assertThat(Files.readAllLines(LEDGER)).hasSize(1);
        assertThat(count("SELECT COUNT(*) FROM users WHERE id = ?", a)).isZero();
    }

    @Test
    void aDeletionAfterUtcMidnightGoesToTheNextDaysFile() throws Exception {
        String a = newUser();
        String b = newUser();
        clock.advance(Duration.ofHours(11).plusMinutes(59).plusSeconds(59)); // 23:59:59 on the 8th
        assertThat(delete(a)).isEqualTo(204);
        clock.advance(Duration.ofSeconds(1)); // midnight UTC: the 9th
        assertThat(delete(b)).isEqualTo(204);

        assertThat(Files.readAllLines(LEDGER)).containsExactly(a + "\t2026-10-08T23:59:59Z");
        assertThat(Files.readAllLines(DIR.resolve("erasures-2026-10-09.log"))).containsExactly(b + "\t2026-10-09T00:00:00Z");
        try (Stream<Path> files = Files.list(DIR)) {
            assertThat(files).hasSize(2);
        }
    }
}
