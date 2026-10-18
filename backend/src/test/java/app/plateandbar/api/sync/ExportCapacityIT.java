package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** A refusal because exports are at capacity spends neither the IP's nor the user's export allowance. */
@TestPropertySource(
        properties = {
            "app.export.max-concurrent=1",
            "app.rate-limit.export-per-ip.capacity=2",
            "app.rate-limit.export-per-user.capacity=1"
        })
class ExportCapacityIT extends SyncITBase {

    @MockitoSpyBean SyncExporter exporter;
    @LocalServerPort int port;

    private CompletableFuture<HttpResponse<String>> export(String user) {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/me/export"))
                .header("Authorization", "Bearer " + jwt.issue(user).value())
                .build();
        return HttpClient.newHttpClient().sendAsync(req, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void aCapacityRefusalLeavesTheIpAndTheUserAllowanceUntouched() throws Exception {
        CountDownLatch inside = new CountDownLatch(1);
        CountDownLatch go = new CountDownLatch(1);
        doAnswer(inv -> {
                    inside.countDown();
                    assertThat(go.await(20, TimeUnit.SECONDS)).isTrue();
                    return inv.callRealMethod();
                })
                .when(exporter)
                .writeTables(any(), any());
        CompletableFuture<HttpResponse<String>> holder = export(newUser()); // the IP's 1st
        assertThat(inside.await(20, TimeUnit.SECONDS)).isTrue();

        String waiting = newUser();
        for (int i = 0; i < 3; i++) { // more refusals than the IP (2) or the user (1) could pay for
            assertThat(export(waiting).get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(429);
        }
        go.countDown();
        assertThat(holder.get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        // The IP has one export left and `waiting` its one: both were still intact.
        assertThat(export(waiting).get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
    }
}
