package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.SequenceInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Real server: bodies with no Content-Length, and multipart, on the real filter chain (H1). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AiITBase.Config.class)
class RequestLimitsIT extends AiITBase {

    @MockitoBean AiProvider provider;
    @LocalServerPort int port;

    private HttpResponse<String> chunked(String path, String token, long bytes, String contentType) throws Exception {
        // Unknown length: the client sends Transfer-Encoding: chunked.
        var open = new ByteArrayInputStream("{\"email\":\"".getBytes());
        var rest = new java.io.InputStream() {
            long left = bytes;
            @Override public int read() { return left-- > 0 ? 'a' : -1; }
        };
        var in = new SequenceInputStream(open, rest);
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", contentType)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> in));
        if (token != null) {
            b.header("Authorization", "Bearer " + token);
        }
        return HttpClient.newHttpClient().send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void aChunkedBodyOverTheLimitIsCutOffOnAuthAndAiEndpoints() throws Exception {
        var auth = chunked("/api/v1/auth/email/start", null, 3L * 1024 * 1024, "application/json");
        assertThat(auth.statusCode()).isEqualTo(400);
        assertThat(auth.body()).contains("invalid_request").contains("too_large");
        var ai = chunked("/api/v1/ai/describe-meal", jwt.issue(newUser()).value(), 3L * 1024 * 1024, "application/json");
        // The AI endpoint stops reading at 16 KB, so the answer is the switch (off) or validation, never a 413.
        assertThat(ai.statusCode()).isIn(400, 503);
        assertThat(ai.body()).contains("\"code\"");
    }

    @Test
    void aMultipartPostGetsTheContractErrorNotA413() throws Exception {
        var res = chunked("/api/v1/ai/describe-meal", jwt.issue(newUser()).value(), 100, "multipart/form-data; boundary=x");
        assertThat(res.statusCode()).isNotEqualTo(413).isBetween(400, 499);
        assertThat(res.body()).contains("\"code\":\"invalid_request\"");
    }
}
