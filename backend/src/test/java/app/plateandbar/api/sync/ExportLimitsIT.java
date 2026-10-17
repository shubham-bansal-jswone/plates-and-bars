package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.autoconfigure.WebMvcProperties;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.ObjectMapper;

/** The export's resource bounds: the async timeout that applies to it, and the cap on exports streaming at once. */
@TestPropertySource(properties = "app.export.max-concurrent=1")
class ExportLimitsIT extends SyncITBase {

    @MockitoSpyBean SyncExporter exporter;
    @LocalServerPort int port;
    @Autowired ObjectMapper mapper;
    @Autowired WebMvcProperties mvc;

    private CompletableFuture<HttpResponse<String>> export(String user) {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/me/export"))
                .header("Authorization", "Bearer " + jwt.issue(user).value())
                .build();
        return HttpClient.newHttpClient().sendAsync(req, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void theAsyncTimeoutIsTenMinutesNotTomcatsThirtySecondDefault() {
        assertThat(mvc.getAsync().getRequestTimeout()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    void aSecondExportWhileTheFirstStreamsIs429WithRetryAfterAndThePlaceIsGivenBack() throws Exception {
        CountDownLatch inside = new CountDownLatch(1);
        CountDownLatch go = new CountDownLatch(1);
        doAnswer(inv -> {
                    inside.countDown();
                    assertThat(go.await(20, TimeUnit.SECONDS)).isTrue();
                    return inv.callRealMethod();
                })
                .when(exporter)
                .writeTables(any(), any());
        CompletableFuture<HttpResponse<String>> first = export(newUser());
        assertThat(inside.await(20, TimeUnit.SECONDS)).isTrue();

        HttpResponse<String> refused = export(newUser()).get(20, TimeUnit.SECONDS);
        assertThat(refused.statusCode()).isEqualTo(429);
        assertThat(refused.headers().firstValue("Retry-After")).isPresent();
        assertThat(mapper.readTree(refused.body()).path("code").asString()).isEqualTo("rate_limited");

        go.countDown();
        assertThat(first.get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        org.mockito.Mockito.reset(exporter);
        assertThat(export(newUser()).get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(200); // finished: place free
    }

    @Test
    void aFailedExportGivesItsPlaceBack() throws Exception {
        doAnswer(inv -> {
                    throw new IllegalStateException("boom");
                })
                .when(exporter)
                .writeTables(any(), any());
        assertThat(export(newUser()).get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(500);
        org.mockito.Mockito.reset(exporter);
        assertThat(export(newUser()).get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
    }
}
