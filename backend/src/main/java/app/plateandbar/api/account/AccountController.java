package app.plateandbar.api.account;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
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
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** {@code GET /api/v1/me/export} and {@code DELETE /api/v1/me}. The user is always the token's principal. */
@RestController
@RequestMapping("/api/v1/me")
public class AccountController {

    private static final Logger log = LoggerFactory.getLogger(AccountController.class);

    private final AccountService accounts;
    private final RateLimiter limiter;
    private final ClientIpResolver ips;
    private final RateLimitProperties limits;
    private final Clock clock;

    AccountController(
            AccountService accounts,
            RateLimiter limiter,
            ClientIpResolver ips,
            RateLimitProperties limits,
            Clock clock) {
        this.accounts = accounts;
        this.limiter = limiter;
        this.ips = ips;
        this.limits = limits;
        this.clock = clock;
    }

    @GetMapping(path = "/export", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StreamingResponseBody> export(Authentication auth, HttpServletRequest request) {
        String userId = auth.getName();
        // IP first: a refusal there must not spend the user's own allowance.
        limiter.consume("export-ip", ips.resolve(request), limits.getExportPerIp());
        limiter.consume("export-user", userId, limits.getExportPerUser());
        accounts.requireAccount(userId); // a 401 must be sent before the first byte of the body
        Instant now = clock.instant();
        StreamingResponseBody body = out -> {
            try {
                long bytes = accounts.writeExport(userId, now, out);
                log.info("Export written: user {} at {} ({} bytes)", userId, now, bytes);
            } catch (IOException | RuntimeException e) {
                // The 200 is already on the wire; the body stays unfinished and the exception aborts the response.
                // Log the type only: a message could quote a row.
                log.error("Export failed after the response started: user {} at {} ({})", userId, now, e.getClass().getName());
                throw e;
            }
        };
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"plate-and-bar-export-" + now.atZone(ZoneOffset.UTC).toLocalDate()
                                + ".json\"")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body);
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(Authentication auth) {
        accounts.delete(auth.getName());
    }
}
