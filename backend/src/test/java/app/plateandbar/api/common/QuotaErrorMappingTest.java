package app.plateandbar.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.ai.AiQuota;
import app.plateandbar.api.ai.QuotaExceededException;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

class QuotaErrorMappingTest {

    @Test
    void quotaExceededIs429WithQuotaBodyAndRetryAfter() {
        AiQuota q = new AiQuota(10, 0, Instant.parse("2026-10-10T00:00:00Z"));
        ResponseEntity<ErrorResponse> r = new ApiExceptionHandler().quotaExceeded(new QuotaExceededException(q, 3600));
        assertThat(r.getStatusCode().value()).isEqualTo(429);
        assertThat(r.getHeaders().getFirst("Retry-After")).isEqualTo("3600");
        assertThat(r.getBody().code()).isEqualTo("quota_exceeded");
        assertThat(r.getBody().quota()).isEqualTo(q);
    }

    @Test
    void otherErrorsOmitQuota() throws Exception {
        String json = new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(ErrorResponse.of("rate_limited", "x"));
        assertThat(json).doesNotContain("quota");
    }
}
