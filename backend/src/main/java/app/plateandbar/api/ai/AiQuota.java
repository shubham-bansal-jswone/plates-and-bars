package app.plateandbar.api.ai;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;

/** The contract's {@code AiQuota}: the user's shared daily allowance after a call. */
public record AiQuota(
        @JsonProperty("limit") int limit,
        @JsonProperty("remaining") int remaining,
        @JsonProperty("resets_at") Instant resetsAt) {}
