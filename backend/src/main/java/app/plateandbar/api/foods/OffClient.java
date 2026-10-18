package app.plateandbar.api.foods;

import app.plateandbar.api.common.UpstreamException;
import app.plateandbar.api.ratelimit.RateLimitProperties.Limit;
import app.plateandbar.api.ratelimit.RateLimitedException;
import app.plateandbar.api.ratelimit.RateLimiter;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The only caller of Open Food Facts (ADR 009): one GET of the API v2 product endpoint with a {@code fields=} whitelist, a
 * {@code User-Agent} naming us and the configured contact, a connect and a total read timeout, a response size cap, no
 * redirects, and one bounded retry (an I/O error, a timeout or a 5xx; not a 4xx). Only digits of a validated barcode ever
 * reach the URL, and the host is fixed configuration. Every attempt, the retry included, takes a token from one limiter
 * shared by all requests (12 per minute by default). Nothing here logs the URL, the barcode or an exception message
 * (they can contain the URL).
 */
@Component
class OffClient {
    private static final Logger log = LoggerFactory.getLogger(OffClient.class);

    private final OffProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http;
    private final String userAgent;
    /** Its own cache (one key), so a flood of distinct client IPs can never evict the upstream bucket. */
    private final RateLimiter limiter;
    private final Limit limit;
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "off-body-watchdog");
        t.setDaemon(true);
        return t;
    });

    OffClient(OffProperties props, ObjectMapper mapper, Clock clock) {
        this.props = props;
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                .connectTimeout(props.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        String version = OffClient.class.getPackage().getImplementationVersion();
        this.userAgent = "PlateAndBar/" + (version == null ? "dev" : version) + " (" + props.contact() + ")";
        this.limiter = new RateLimiter(clock, 4);
        this.limit = new Limit(props.upstreamPerMinute(), Duration.ofMinutes(1));
    }

    String userAgent() {
        return userAgent;
    }

    /** The product object, or empty when Open Food Facts has none. Throws {@link UpstreamException} (503) otherwise. */
    Optional<JsonNode> fetch(String code) {
        URI uri = URI.create(props.baseUrl() + "/api/v2/product/" + code + "?fields=" + OffMapper.FIELDS);
        long start = System.nanoTime();
        String outcome = "unavailable";
        try {
            for (int attempt = 1; ; attempt++) {
                takeToken(attempt);
                Attempt result = attempt(uri);
                if (result.retryable && attempt == 1) {
                    sleepBeforeRetry();
                    continue;
                }
                if (result.failed()) {
                    throw UpstreamException.unavailable();
                }
                outcome = result.product.isPresent() ? "found" : "missing";
                return result.product;
            }
        } catch (UpstreamException e) {
            outcome = e.code().equals("upstream_busy") ? "busy" : "unavailable";
            throw e;
        } finally {
            log.info("Open Food Facts lookup (outcome={}, ms={})", outcome, (System.nanoTime() - start) / 1_000_000);
        }
    }

    private void takeToken(int attempt) {
        try {
            limiter.consume("off-upstream", "off", limit);
        } catch (RateLimitedException e) {
            // The first call is refused as busy; a retry that finds no token left just gives up.
            throw attempt == 1 ? UpstreamException.busy(e.retryAfterSeconds()) : UpstreamException.unavailable();
        }
    }

    private void sleepBeforeRetry() {
        try {
            Thread.sleep(props.retryBackoff().toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw UpstreamException.unavailable();
        }
    }

    private record Attempt(Optional<JsonNode> product, boolean retryable, boolean failed) {
        static Attempt found(JsonNode product) { return new Attempt(Optional.of(product), false, false); }
        static Attempt missing() { return new Attempt(Optional.empty(), false, false); }
        static Attempt retry() { return new Attempt(Optional.empty(), true, true); }
        static Attempt fail() { return new Attempt(Optional.empty(), false, true); }
    }

    private Attempt attempt(URI uri) {
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(props.readTimeout())
                .header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .GET()
                .build();
        long deadline = System.nanoTime() + props.readTimeout().toNanos();
        try {
            HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                int status = response.statusCode();
                if (status == 404) {
                    return Attempt.missing();
                }
                if (status >= 500) {
                    return Attempt.retry();
                }
                if (status != 200) {
                    return Attempt.fail();
                }
                // The request timeout stops at the headers: close the stream when the total time is up so a slow body cannot hang.
                ScheduledFuture<?> cut = watchdog.schedule(() -> closeQuietly(body),
                        Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
                byte[] bytes;
                try {
                    bytes = body.readNBytes(props.maxBodyBytes() + 1);
                } finally {
                    cut.cancel(false);
                }
                if (bytes.length > props.maxBodyBytes()) {
                    return Attempt.fail();
                }
                return interpret(mapper.readTree(bytes));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Attempt.fail();
        } catch (IOException e) {
            return Attempt.retry();
        } catch (RuntimeException e) {
            // An unreadable body (or a bad URI): not worth a retry.
            return Attempt.fail();
        }
    }

    /** Status 1 and a product object is a hit; status 0 (or a missing product) is a miss; anything else is a failure. */
    private static Attempt interpret(JsonNode root) {
        JsonNode status = root.path("status");
        boolean one = status.isNumber() ? status.asInt() == 1 : status.isString() && "1".equals(status.asString().trim());
        boolean zero = status.isNumber() ? status.asInt() == 0 : status.isString() && "0".equals(status.asString().trim());
        if (one && root.path("product").isObject()) {
            return Attempt.found(root.path("product"));
        }
        return zero || one ? Attempt.missing() : Attempt.fail();
    }

    private static void closeQuietly(InputStream in) {
        try {
            in.close();
        } catch (IOException | RuntimeException ignored) {
            // The read in progress fails, which is the point.
        }
    }
}
