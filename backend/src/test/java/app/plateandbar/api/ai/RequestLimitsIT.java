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
        var ai = chunked("/api/v1/ai/describe-meal", jwt.issue(newUser()).value(), 100L * 1024, "application/json");
        // Over 16 KB but small enough for the server to drain (so the client sees the answer, not a reset): the
        // AI endpoint stops reading at 16 KB; the answer is the switch (off) or too_large, never a 413.
        assertThat(ai.statusCode()).isIn(400, 503);
        assertThat(ai.body()).contains("\"code\"");
    }

    @Test
    void aMultipartPostGetsTheContractErrorNotA413() throws Exception {
        var res = chunked("/api/v1/ai/describe-meal", jwt.issue(newUser()).value(), 100, "multipart/form-data; boundary=x");
        assertThat(res.statusCode()).isNotEqualTo(413).isBetween(400, 499);
        assertThat(res.body()).contains("\"code\":\"invalid_request\"");
    }

    private HttpResponse<String> declared(String method, String path, byte[] body) throws Exception {
        var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofByteArray(body));
        return HttpClient.newHttpClient().send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static byte[] jsonOfSize(int bytes) {
        String head = "{\"email\":\"";
        String tail = "\"}";
        return (head + "a".repeat(bytes - head.length() - tail.length()) + tail).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    @Test
    void aDeclaredLengthOverTwoMegabytesIs400TooLargeBeforeAuthOnEveryKindOfEndpoint() throws Exception {
        byte[] over = jsonOfSize(2 * 1024 * 1024 + 1);
        // No token at all: the size answer comes before any 401, on sign-in, sync and the account endpoints.
        for (String[] c : new String[][] {
                {"POST", "/api/v1/auth/email/start"}, {"POST", "/api/v1/auth/refresh"},
                {"POST", "/api/v1/sync"}, {"DELETE", "/api/v1/me"}}) {
            var res = declared(c[0], c[1], over);
            assertThat(res.statusCode()).as(c[1]).isEqualTo(400);
            var body = json.readTree(res.body());
            assertThat(body.path("code").asString()).isEqualTo("invalid_request");
            assertThat(body.path("details")).hasSize(1);
            assertThat(body.path("details").get(0).path("field").stringValue()).isEmpty();
            assertThat(body.path("details").get(0).path("issue").asString()).isEqualTo("too_large");
        }
    }

    @Test
    void aBodyOfExactlyTwoMegabytesIsNotTooLarge() throws Exception {
        var res = declared("POST", "/api/v1/auth/email/start", jsonOfSize(2 * 1024 * 1024));
        assertThat(res.body()).doesNotContain("too_large");
        assertThat(res.statusCode()).isEqualTo(400);
        assertThat(json.readTree(res.body()).path("details").get(0).path("field").asString()).isEqualTo("email");
        var sync = declared("POST", "/api/v1/sync", jsonOfSize(2 * 1024 * 1024));
        assertThat(sync.statusCode()).isEqualTo(401);
    }
}
