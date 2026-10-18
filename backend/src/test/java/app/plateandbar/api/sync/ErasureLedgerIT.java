package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** DELETE /me and the erasure ledger (#850) on real MySQL and a real file. Lives in the sync package for its fixtures. */
class ErasureLedgerIT extends SyncITBase {

    static final Path LEDGER = tempLedger();

    private static Path tempLedger() {
        try {
            return Files.createTempDirectory("ledger-it").resolve("erasures.log");
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void ledger(DynamicPropertyRegistry r) {
        r.add("app.erasure-ledger.path", LEDGER::toString);
    }

    @BeforeEach
    void emptyLedger() throws Exception {
        if (Files.isDirectory(LEDGER)) {
            Files.delete(LEDGER);
        }
        Files.deleteIfExists(LEDGER);
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
}
