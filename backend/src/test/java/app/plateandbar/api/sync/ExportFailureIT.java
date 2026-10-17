package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

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

    /** Raw HTTP/1.1 over a socket, so the chunked framing is visible: everything the server sent until it closed. */
    private String raw(String user) throws Exception {
        try (java.net.Socket sock = new java.net.Socket("localhost", port)) {
            sock.setSoTimeout(20000);
            sock.getOutputStream()
                    .write(("GET /api/v1/me/export HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer "
                                    + jwt.issue(user).value() + "\r\nConnection: close\r\n\r\n")
                            .getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            try {
                for (int n; (n = sock.getInputStream().read(buf)) > 0; ) {
                    all.write(buf, 0, n);
                }
            } catch (java.net.SocketException reset) {
                // an abort may surface as a reset; what arrived before it is still in `all`
            }
            return all.toString(java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    @Test
    void aFailureAfterBytesWereSentAbortsTheConnectionWithoutAFinalChunkOrAnErrorBody() throws Exception {
        String user = newUser();
        for (int i = 1; i <= 400; i++) { // well over the 8 KB the server buffers before the 200 is committed
            jdbc.update(
                    "INSERT INTO water_logs (user_id, id, version, updated_at, deleted_at, seq, data)"
                            + " VALUES (?, ?, 1, '2026-10-08 11:00:00.000', NULL, ?, CAST(? AS JSON))",
                    user, ExportGoldenIT.rid(i), i, "{\"date\":\"2026-10-08\",\"ml\":250,\"t\":\"2026-10-08T11:00:00Z\"}");
        }
        doThrow(new IllegalStateException("boom")).when(exporter).writeConflictLog(any(), any());
        String wire = raw(user);
        assertThat(wire).startsWith("HTTP/1.1 200");
        assertThat(wire).contains("\"tables\""); // the stream really had started
        assertThat(wire).doesNotContain("\r\n0\r\n\r\n"); // no terminating chunk: the client sees an aborted transfer
        assertThat(wire).doesNotContain("\"code\":\"internal\""); // and no Error object appended to the document
    }
}
