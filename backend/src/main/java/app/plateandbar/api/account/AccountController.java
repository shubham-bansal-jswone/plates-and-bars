package app.plateandbar.api.account;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /api/v1/me/export} and {@code DELETE /api/v1/me}. The user is always the token's principal. */
@RestController
@RequestMapping("/api/v1/me")
public class AccountController {

    private static final Logger log = LoggerFactory.getLogger(AccountController.class);

    private final AccountService accounts;
    private final RateLimiter limiter;
    private final ClientIpResolver ips;
    private final RateLimitProperties limits;
    private final ObjectMapper json;
    private final Clock clock;

    AccountController(
            AccountService accounts,
            RateLimiter limiter,
            ClientIpResolver ips,
            RateLimitProperties limits,
            ObjectMapper json,
            Clock clock) {
        this.accounts = accounts;
        this.limiter = limiter;
        this.ips = ips;
        this.limits = limits;
        this.json = json;
        this.clock = clock;
    }

    @GetMapping(path = "/export", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> export(Authentication auth, HttpServletRequest request) throws Exception {
        String userId = auth.getName();
        // IP first: a refusal there must not spend the user's own allowance.
        limiter.consume("export-ip", ips.resolve(request), limits.getExportPerIp());
        limiter.consume("export-user", userId, limits.getExportPerUser());
        Instant now = clock.instant();
        ObjectNode body = accounts.export(userId, now);
        byte[] bytes = json.writeValueAsBytes(body);
        log.info("Export built: user {} at {} ({} bytes)", userId, now, bytes.length);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"plate-and-bar-export-" + now.atZone(ZoneOffset.UTC).toLocalDate()
                                + ".json\"")
                .contentType(MediaType.APPLICATION_JSON)
                .body(bytes);
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(Authentication auth) {
        accounts.delete(auth.getName());
    }
}
