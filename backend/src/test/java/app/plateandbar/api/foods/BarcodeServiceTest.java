package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.UpstreamException;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class BarcodeServiceTest {

    private static final String CODE = "8901491101837";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final BarcodeCache cache = mock(BarcodeCache.class);
    private final OffClient client = mock(OffClient.class);

    private BarcodeService service(boolean enabled) {
        return new BarcodeService(new OffProperties(enabled, null, enabled ? "me@example.org" : null, null, null, null, null, null, null, null),
                cache, client, JSON);
    }

    private static Optional<JsonNode> upstream() {
        return Optional.of(JSON.readTree("{\"product_name\":\"x\",\"nutriments\":{\"fat_100g\":1}}"));
    }

    @Test
    void invalidCodeIs400BeforeTheFlagTheCacheOrTheUpstream() {
        for (boolean enabled : new boolean[] {true, false}) {
            assertThatThrownBy(() -> service(enabled).lookup("8901491101838"))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("invalid_barcode"));
        }
        verify(cache, never()).find(anyString());
        verify(client, never()).fetch(anyString());
    }

    @Test
    void disabledIsUnavailableAndTouchesNothing() {
        assertThatThrownBy(() -> service(false).lookup(CODE))
                .isInstanceOfSatisfying(UpstreamException.class, e -> assertThat(e.code()).isEqualTo("upstream_unavailable"));
        verify(cache, never()).find(anyString());
        verify(client, never()).fetch(anyString());
    }

    @Test
    void aCacheErrorIsAMissNotAFailedLookup() {
        when(cache.find(CODE)).thenThrow(new DataAccessResourceFailureException("db down for " + CODE));
        org.mockito.Mockito.doThrow(new DataAccessResourceFailureException("db down")).when(cache).put(anyString(), any());
        when(client.fetch(CODE)).thenReturn(upstream());
        assertThat(service(true).lookup(CODE).path("code").asString()).isEqualTo(CODE);
        verify(client).fetch(CODE);
    }

    @Test
    void aCachedHitOrMissNeverCallsTheUpstream() {
        when(cache.find(CODE)).thenReturn(Optional.of(new BarcodeCache.Entry(true, "{\"code\":\"" + CODE + "\"}")));
        assertThat(service(true).lookup(CODE).path("code").asString()).isEqualTo(CODE);
        when(cache.find(CODE)).thenReturn(Optional.of(new BarcodeCache.Entry(false, null)));
        assertThatThrownBy(() -> service(true).lookup(CODE))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("not_found"));
        verify(client, never()).fetch(anyString());
    }

    @Test
    void anUpstreamFailureIsNotCached() {
        when(cache.find(CODE)).thenReturn(Optional.empty());
        when(client.fetch(CODE)).thenThrow(UpstreamException.busy(7));
        assertThatThrownBy(() -> service(true).lookup(CODE))
                .isInstanceOfSatisfying(UpstreamException.class, e -> assertThat(e.retryAfterSeconds()).isEqualTo(7));
        verify(cache, never()).put(anyString(), any());
    }

    @Test
    void anUpstreamMissIsCachedAsAMiss() {
        when(cache.find(CODE)).thenReturn(Optional.empty());
        when(client.fetch(CODE)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service(true).lookup(CODE)).isInstanceOf(ApiException.class);
        verify(cache).put(CODE, null);
    }
}
