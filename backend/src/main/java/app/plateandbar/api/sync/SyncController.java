package app.plateandbar.api.sync;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code POST /api/v1/sync}. The user is the authenticated principal; nothing in the body names a user. */
@RestController
@RequestMapping("/api/v1/sync")
public class SyncController {

    private final SyncRequestValidator validator;
    private final SyncService sync;

    public SyncController(SyncRequestValidator validator, SyncService sync) {
        this.validator = validator;
        this.sync = sync;
    }

    @PostMapping
    public JsonNode sync(@RequestBody(required = false) JsonNode body, Authentication auth) {
        String userId = auth.getName();
        return sync.sync(userId, validator.validate(userId, body));
    }
}
