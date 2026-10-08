package app.plateandbar.api.sync;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/v1/sync}. The user is the authenticated principal; nothing in the body names a user.
 * The body is read here, at most {@code app.sync.max-body-bytes} of it (default 2 MB), so an oversized
 * request is refused with 400 {@code invalid_request} (detail {@code too_large}) before it is parsed.
 */
@RestController
@RequestMapping("/api/v1/sync")
public class SyncController {

    private final SyncRequestValidator validator;
    private final SyncService sync;
    private final ObjectMapper json;
    private final int maxBodyBytes;

    public SyncController(
            SyncRequestValidator validator,
            SyncService sync,
            ObjectMapper json,
            @Value("${app.sync.max-body-bytes:2097152}") int maxBodyBytes) {
        this.validator = validator;
        this.sync = sync;
        this.json = json;
        this.maxBodyBytes = maxBodyBytes;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public JsonNode sync(HttpServletRequest request, Authentication auth) throws IOException {
        byte[] raw = request.getInputStream().readNBytes(maxBodyBytes + 1);
        if (raw.length > maxBodyBytes) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "invalid_request",
                    "The request is not valid.",
                    List.of(new ErrorResponse.Detail("", "too_large")));
        }
        JsonNode body;
        try {
            body = json.readTree(raw);
        } catch (JsonProcessingException e) {
            body = null; // the validator answers 400; the parser's message may quote the body
        }
        String userId = auth.getName();
        return sync.sync(userId, validator.validate(userId, body));
    }
}
