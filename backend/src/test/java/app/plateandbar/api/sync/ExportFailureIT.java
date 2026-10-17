package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.ObjectMapper;

/**
 * How {@code GET /me/export} fails after the work has started (here: reading the conflict log, the last part of the
 * document). Before the first byte leaves the server's response buffer the client gets a normal 500 {@code Error};
 * once bytes have gone out the 200 cannot be taken back, so the response is aborted and the client sees an I/O error
 * (an unterminated chunked body), never a complete, valid document.
 */
class ExportFailureIT extends SyncITBase {

    @MockitoSpyBean SyncExporter exporter;
    @LocalServerPort int port;
    @Autowired ObjectMapper mapper;

    private HttpResponse<String> export(String user) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/me/export"))
                .header("Authorization", "Bearer " + jwt.issue(user).value())
                .build();
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void aFailureBeforeAnyByteWasSentIsAnOrdinary500Error() throws Exception {
        String user = newUser();
        doThrow(new IllegalStateException("boom")).when(exporter).writeConflictLog(any(), any());
        HttpResponse<String> res = export(user);
        assertThat(res.statusCode()).isEqualTo(500);
        assertThat(mapper.readTree(res.body()).path("code").asString()).isEqualTo("internal");
    }

    @Test
    void aFailureAfterBytesWereSentAbortsTheResponseInsteadOfEndingValidJson() throws Exception {
        String user = newUser();
        for (int i = 1; i <= 400; i++) { // well over the 8 KB the server buffers before the 200 is committed
            jdbc.update(
                    "INSERT INTO water_logs (user_id, id, version, updated_at, deleted_at, seq, data)"
                            + " VALUES (?, ?, 1, '2026-10-08 11:00:00.000', NULL, ?, CAST(? AS JSON))",
                    user, ExportGoldenIT.rid(i), i, "{\"date\":\"2026-10-08\",\"ml\":250,\"t\":\"2026-10-08T11:00:00Z\"}");
        }
        doThrow(new IllegalStateException("boom")).when(exporter).writeConflictLog(any(), any());
        try {
            HttpResponse<String> res = export(user);
            assertThat(res.statusCode()).isEqualTo(200);
            assertThatThrownBy(() -> mapper.readTree(res.body())).isInstanceOf(Exception.class);
        } catch (IOException aborted) {
            assertThat(aborted).isNotNull(); // the usual outcome: connection closed before the final chunk
        }
    }
}
