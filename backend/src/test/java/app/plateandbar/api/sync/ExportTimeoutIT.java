package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** An export that outlives the async timeout is aborted like any failure after the 200: no final chunk, no body added. */
@TestPropertySource(properties = {"spring.mvc.async.request-timeout=2s", "app.rate-limit.export-per-ip.capacity=1000"})
class ExportTimeoutIT extends SyncITBase {

    @MockitoSpyBean SyncExporter exporter;
    @LocalServerPort int port;

    @Test
    void aTimedOutExportEndsWithoutAFinalChunk() throws Exception {
        String user = newUser();
        for (int i = 1; i <= 400; i++) { // past the 8 KB response buffer, so the 200 is committed
            jdbc.update(
                    "INSERT INTO water_logs (user_id, id, version, updated_at, deleted_at, seq, data)"
                            + " VALUES (?, ?, 1, '2026-10-08 11:00:00.000', NULL, ?, CAST(? AS JSON))",
                    user, ExportGoldenIT.rid(i), i, "{\"date\":\"2026-10-08\",\"ml\":250,\"t\":\"2026-10-08T11:00:00Z\"}");
        }
        doAnswer(inv -> {
                    inv.callRealMethod();
                    long end = System.nanoTime() + 5_000_000_000L; // outlasts the timeout, and ignores the interrupt
                    while (System.nanoTime() < end) {
                        try {
                            Thread.sleep(100);
                        } catch (InterruptedException ignored) {
                            // keep going: a writer stuck on a slow client does not notice either
                        }
                    }
                    return null;
                })
                .when(exporter)
                .writeTables(any(), any());
        String wire = ExportFailureIT.raw(port, jwt.issue(user).value());
        assertThat(wire).startsWith("HTTP/1.1 200");
        assertThat(wire).contains("\"tables\"");
        assertThat(wire).doesNotContain("\r\n0\r\n\r\n");
        assertThat(wire).doesNotContain("\"timestamp\"").doesNotContain("\"code\"");
    }
}
