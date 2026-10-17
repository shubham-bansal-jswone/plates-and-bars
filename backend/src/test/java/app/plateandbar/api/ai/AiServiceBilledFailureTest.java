package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.plateandbar.api.common.ApiException;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Once the provider has answered, any failure keeps the quota unit; only a failed call releases it. */
class AiServiceBilledFailureTest {

    final ObjectMapper json = new ObjectMapper();
    AiQuotaService quotas = mock(AiQuotaService.class);
    AiProvider provider = mock(AiProvider.class);
    AiReplies replies = mock(AiReplies.class);
    AiService service;
    final AiQuotaService.Reservation held = new AiQuotaService.Reservation(
            "u", java.time.LocalDate.of(2026, 10, 8), AiFeature.DESCRIBE_MEAL,
            new AiQuota(10, 9, Instant.parse("2026-10-09T00:00:00Z")));

    @BeforeEach
    void setUp() {
        when(quotas.reserve(any(), any())).thenReturn(held);
        service = new AiService(quotas, provider, mock(AiSchemas.class), mock(AiContent.class), replies, json);
    }

    private void call() {
        service.describeMeal("u", json.createObjectNode().put("text", "rice"));
    }

    @Test
    void aParserThatThrowsAfterABilledResponseKeepsTheUnit() {
        when(provider.complete(any(), any(), any())).thenReturn(new AiProvider.Completion("{}", 10, 5));
        when(replies.describeMeal(any())).thenThrow(new IllegalStateException("parser bug"));
        assertThatThrownBy(this::call).isInstanceOfSatisfying(ApiException.class, e -> {
            org.assertj.core.api.Assertions.assertThat(e.status().value()).isEqualTo(503);
            org.assertj.core.api.Assertions.assertThat(e.code()).isEqualTo("unavailable");
        });
        verify(quotas).recordTokens(held, 10, 5);
        verify(quotas, never()).release(any());
    }

    @Test
    void failingToRecordTheTokensOfABilledResponseStillKeepsTheUnit() {
        when(provider.complete(any(), any(), any())).thenReturn(new AiProvider.Completion("{}", 10, 5));
        doThrow(new IllegalStateException("db down")).when(quotas).recordTokens(any(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());
        assertThatThrownBy(this::call).isInstanceOf(ApiException.class);
        verify(quotas, never()).release(any());
    }

    @Test
    void aFailedProviderCallReleasesTheUnit() {
        when(provider.complete(any(), any(), any())).thenThrow(new IllegalStateException("timeout"));
        assertThatThrownBy(this::call).isInstanceOf(ApiException.class);
        verify(quotas).release(held);
        verify(quotas, never()).recordTokens(any(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());
    }
}
