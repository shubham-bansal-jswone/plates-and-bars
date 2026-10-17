package app.plateandbar.api.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import app.plateandbar.api.ai.AiQuota;
import java.util.List;

/** The contract's shared {@code Error} schema. Codes are the enum in openapi.yaml. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(
        @JsonProperty("code") String code,
        @JsonProperty("message") String message,
        @JsonProperty("details") List<Detail> details,
        @JsonProperty("quota") AiQuota quota,
        @JsonProperty("record_cap") RecordCap recordCap) {

    public ErrorResponse(String code, String message, List<Detail> details) {
        this(code, message, details, null, null);
    }

    public ErrorResponse(String code, String message, List<Detail> details, AiQuota quota) {
        this(code, message, details, quota, null);
    }

    public record Detail(String field, String issue) {}

    /** Why a push was refused with {@code account_full}: {@code stored + new_records} is over {@code limit}. */
    public record RecordCap(
            @JsonProperty("limit") long limit,
            @JsonProperty("stored") long stored,
            @JsonProperty("new_records") long newRecords) {}

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, null);
    }
}
