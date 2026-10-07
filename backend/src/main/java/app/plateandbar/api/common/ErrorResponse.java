package app.plateandbar.api.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** The contract's shared {@code Error} schema. Codes are the enum in openapi.yaml. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(
        @JsonProperty("code") String code,
        @JsonProperty("message") String message,
        @JsonProperty("details") List<Detail> details) {

    public record Detail(String field, String issue) {}

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, null);
    }
}
