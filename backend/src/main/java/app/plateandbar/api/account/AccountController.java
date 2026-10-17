package app.plateandbar.api.account;

import app.plateandbar.api.ratelimit.ClientIpResolver;
import app.plateandbar.api.ratelimit.RateLimitProperties;
import app.plateandbar.api.ratelimit.RateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import app.plateandbar.api.ratelimit.RateLimitedException;
import java.io.IOException;
import java.util.concurrent.Callable;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.async.CallableProcessingInterceptor;
import org.springframework.web.context.request.async.WebAsyncUtils;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** {@code GET /api/v1/me/export} and {@code DELETE /api/v1/me}. The user is always the token's principal. */
@RestController
@RequestMapping("/api/v1/me")
public class AccountController {

    private static final Logger log = LoggerFactory.getLogger(AccountController.class);

    /** Retry-After for a refusal because exports are at capacity: an export takes seconds to minutes. */
    private static final long EXPORT_BUSY_RETRY_SECONDS = 30;

    private final AccountService accounts;
    private final RateLimiter limiter;
    private final ClientIpResolver ips;
    private final RateLimitProperties limits;
    private final Clock clock;
    private final Semaphore exportSlots;

    AccountController(
            AccountService accounts,
            RateLimiter limiter,
            ClientIpResolver ips,
            RateLimitProperties limits,
            Clock clock,
            @Value("${app.export.max-concurrent:2}") int maxConcurrentExports) {
        this.accounts = accounts;
        this.limiter = limiter;
        this.ips = ips;
        this.limits = limits;
        this.clock = clock;
        this.exportSlots = new Semaphore(maxConcurrentExports);
    }

    @GetMapping(path = "/export", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StreamingResponseBody> export(Authentication auth, HttpServletRequest request) {
        String userId = auth.getName();
        // Capacity first, so a refusal for it spends neither allowance (a client retrying while the server is busy
        // must not use up its hour); then the IP, so a refusal there does not spend the user's own allowance.
        Permit permit = takePermit();
        boolean streaming = false;
        try {
            limiter.consume("export-ip", ips.resolve(request), limits.getExportPerIp());
            limiter.consume("export-user", userId, limits.getExportPerUser());
            accounts.requireAccount(userId); // a 401 must be sent before the first byte of the body
            Instant now = clock.instant();
            StreamingResponseBody body = out -> {
                try {
                    long bytes = accounts.writeExport(userId, now, out);
                    log.info("Export written: user {} at {} ({} bytes)", userId, now, bytes);
                } catch (IOException | RuntimeException e) {
                    // Class only: a message could quote a row. A failure before the first byte reaches the client is a
                    // 500 Error; after it the connection is aborted (ApiExceptionHandler rethrows on a committed response).
                    log.error("Export failed: user {} at {} ({})", userId, now, e.getClass().getName());
                    throw new ExportAbortedException();
                } finally {
                    permit.release();
                }
            };
            // If the body never runs (timeout while queued, client gone), the permit is still given back.
            WebAsyncUtils.getAsyncManager(request)
                    .registerCallableInterceptor("export-permit", new CallableProcessingInterceptor() {
                        /** Past the async timeout the 200 is long sent: end like any other failure, by aborting. */
                        @Override
                        public <T> Object handleTimeout(NativeWebRequest r, Callable<T> task) {
                            log.error("Export timed out: user {} at {}", userId, now);
                            return new ExportAbortedException(); // Spring's own timeout error would be ignored once committed
                        }

                        @Override
                        public <T> void afterCompletion(NativeWebRequest r, Callable<T> task) {
                            permit.release();
                        }
                    });
            streaming = true;
            return ResponseEntity.ok()
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .header(
                            HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"plate-and-bar-export-" + now.atZone(ZoneOffset.UTC).toLocalDate()
                                    + ".json\"")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body);
        } finally {
            if (!streaming) {
                permit.release();
            }
        }
    }

    /** One of {@code app.export.max-concurrent} places; 429 {@code rate_limited} when none is free. */
    private Permit takePermit() {
        if (!exportSlots.tryAcquire()) {
            throw new RateLimitedException("export-capacity", EXPORT_BUSY_RETRY_SECONDS);
        }
        return new Permit(exportSlots);
    }

    /** Gives its place back once, however many times it is released. */
    private static final class Permit {
        private final Semaphore slots;
        private final AtomicBoolean held = new AtomicBoolean(true);

        Permit(Semaphore slots) {
            this.slots = slots;
        }

        void release() {
            if (held.compareAndSet(true, false)) {
                slots.release();
            }
        }
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(Authentication auth) {
        accounts.delete(auth.getName());
    }
}
