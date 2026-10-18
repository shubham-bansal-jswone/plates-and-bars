package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.sync.ContractSchemas;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import mockwebserver3.MockResponse;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * GET /foods/barcode/{code} end to end with the feature on: real MySQL cache, real filter chain, fake Open Food Facts.
 * The upstream limit is 3 per minute here (so the busy path is cheap to reach) and the fake's read timeout is 600 ms.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.off.enabled=true",
            "app.off.contact=barcode-test@example.org",
            "app.off.retry-backoff=10ms",
            "app.off.read-timeout=600ms",
            "app.off.upstream-per-minute=3",
            "app.off.max-body-bytes=4096"
        })
class BarcodeProxyIT extends BarcodeITBase {

    private static final String OP = "GET /foods/barcode/{code}";
    private static final ObjectMapper JSON = new ObjectMapper();

    private ResponseEntity<String> ok(String code) {
        ResponseEntity<String> r = get(code);
        assertThat(r.getStatusCode().value()).as(r.getBody()).isEqualTo(200);
        ContractSchemas.assertResponse(OP, 200, r.getBody());
        return r;
    }

    private void expect(String code, int status, String errorCode) {
        ResponseEntity<String> r = get(code);
        assertThat(r.getStatusCode().value()).as(r.getBody()).isEqualTo(status);
        ContractSchemas.assertResponse(OP, status, r.getBody());
        assertThat(JSON.readTree(r.getBody()).path("code").asString()).isEqualTo(errorCode);
    }

    @Test
    void foundIsMappedAndAnsweredInTheContractShape() {
        String code = code(1);
        // Open Food Facts may store a UPC-A with a leading zero; the answer's code is still the request's.
        script(code, json(200, product("0" + code)));
        JsonNode body = JSON.readTree(ok(code).getBody());
        assertThat(body.path("code").asString()).isEqualTo(code);
        assertThat(body.path("name").asString()).isEqualTo("Test bar");
        assertThat(body.path("serving_quantity").toString()).isEqualTo("45");
        assertThat(body.path("last_modified_at").asString()).isEqualTo("2026-06-02T09:14:31Z");
        assertThat(body.path("nutriments").propertyNames())
                .containsExactlyInAnyOrder("energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g");
        assertThat(body.path("source").path("url").asString()).isEqualTo("https://world.openfoodfacts.org/product/" + code);
        assertThat(jdbc.queryForObject("SELECT found FROM barcode_cache WHERE code = ?", Integer.class, code)).isEqualTo(1);
    }

    @Test
    void theUpstreamCallIsAFieldsWhitelistedGetWithOurUserAgent() throws Exception {
        String code = code(2);
        script(code, json(200, product(code)));
        ok(code);
        assertThat(REQUESTS).hasSize(1);
        var request = REQUESTS.get(0);
        assertThat(request.getMethod()).isEqualTo("GET");
        assertThat(request.getUrl().encodedPath()).isEqualTo("/api/v2/product/" + code);
        assertThat(request.getUrl().queryParameter("fields")).isEqualTo(OffMapper.FIELDS);
        assertThat(request.getUrl().querySize()).isEqualTo(1);
        assertThat(request.getHeaders().get("User-Agent")).matches("PlateAndBar/\\S+ \\(barcode-test@example\\.org\\)");
        assertThat(request.getHeaders().get("Authorization")).isNull();
        assertThat(request.getHeaders().get("Cookie")).isNull();
    }

    @Test
    void aHitIsCachedForThirtyDaysExactly() {
        String code = code(3);
        script(code, json(200, product(code)), json(200, product(code)));
        ok(code);
        ok(code);
        assertThat(REQUESTS).as("second answer from the cache").hasSize(1);
        clock.advance(Duration.ofDays(30).minusSeconds(1));
        ok(code);
        assertThat(REQUESTS).as("one second before the 30 days are up").hasSize(1);
        clock.advance(Duration.ofSeconds(1));
        ok(code);
        assertThat(REQUESTS).as("expired, fetched again").hasSize(2);
    }

    @Test
    void aMissIsCachedForTwentyFourHoursExactly() {
        String code = code(4);
        script(code, json(404, NOT_FOUND), json(200, product(code)));
        expect(code, 404, "not_found");
        expect(code, 404, "not_found");
        assertThat(REQUESTS).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT found FROM barcode_cache WHERE code = ?", Integer.class, code)).isEqualTo(0);
        clock.advance(Duration.ofHours(24).minusSeconds(1));
        expect(code, 404, "not_found");
        assertThat(REQUESTS).hasSize(1);
        clock.advance(Duration.ofSeconds(1));
        ok(code);
        assertThat(REQUESTS).as("the miss expired, so the product is found now").hasSize(2);
    }

    @Test
    void statusZeroWithHttp200AndAProductWithoutNutrimentsAreBothMisses() {
        String zero = code(5);
        String empty = code(6);
        script(zero, json(200, NOT_FOUND));
        script(empty, json(200, "{\"status\":1,\"product\":{\"product_name\":\"No numbers\",\"nutriments\":{\"sugars_100g\":3}}}"));
        expect(zero, 404, "not_found");
        expect(empty, 404, "not_found");
        expect(zero, 404, "not_found");
        expect(empty, 404, "not_found");
        assertThat(REQUESTS).hasSize(2);
    }

    @Test
    void expiredRowsAreDeletedWhenAnotherCodeIsWritten() {
        jdbc.update("INSERT INTO barcode_cache (code, found, payload, fetched_at, expires_at) VALUES ('96385074', 0, NULL, ?, ?)",
                java.time.LocalDateTime.parse("2026-01-01T00:00:00"), java.time.LocalDateTime.parse("2026-01-02T00:00:00"));
        String code = code(7);
        script(code, json(200, product(code)));
        ok(code);
        assertThat(jdbc.queryForList("SELECT code FROM barcode_cache", String.class)).containsExactly(code);
    }

    @Test
    void invalidCodesAre400WithNoUpstreamCallAndNeverUseTheUpstreamLimiter() {
        for (String bad : new String[] {"8901491101838", "96385075", "123456789012345", "89014911018x7", "00012345678905"}) {
            expect(bad, 400, "invalid_barcode");
        }
        assertThat(REQUESTS).isEmpty();
        // The whole upstream allowance (3) is still there.
        for (int i = 10; i < 13; i++) {
            script(code(i), json(200, product(code(i))));
            ok(code(i));
        }
        assertThat(REQUESTS).hasSize(3);
    }

    @Test
    void cacheHitsNeverUseTheLimiterAndTheFourthNewCodeIsBusyWithRetryAfter() {
        for (int i = 20; i < 23; i++) {
            script(code(i), json(200, product(code(i))));
            ok(code(i));
        }
        for (int i = 20; i < 23; i++) {
            ok(code(i)); // hits: no token needed although the three are used up
        }
        assertThat(REQUESTS).hasSize(3);
        script(code(23), json(200, product(code(23))));
        ResponseEntity<String> busy = get(code(23));
        assertThat(busy.getStatusCode().value()).isEqualTo(503);
        ContractSchemas.assertResponse(OP, 503, busy.getBody());
        assertThat(JSON.readTree(busy.getBody()).path("code").asString()).isEqualTo("upstream_busy");
        assertThat(Integer.parseInt(busy.getHeaders().getFirst("Retry-After"))).isBetween(1, 60);
        assertThat(REQUESTS).as("the busy answer made no upstream call").hasSize(3);
        // Cached misses are hits too.
        clock.advance(Duration.ofMinutes(1));
        ok(code(23));
        assertThat(REQUESTS).hasSize(4);
    }

    @Test
    void oneRetryOnAServerErrorThenSuccess() {
        String code = code(30);
        script(code, json(502, "bad gateway"), json(200, product(code)));
        ok(code);
        assertThat(REQUESTS).hasSize(2);
    }

    @Test
    void aSecondServerErrorIs503UnavailableWithNoThirdTryAndIsNotCached() {
        String code = code(31);
        script(code, json(500, "x"), json(503, "x"), json(200, product(code)));
        ResponseEntity<String> r = get(code);
        assertThat(r.getStatusCode().value()).isEqualTo(503);
        ContractSchemas.assertResponse(OP, 503, r.getBody());
        assertThat(JSON.readTree(r.getBody()).path("code").asString()).isEqualTo("upstream_unavailable");
        assertThat(r.getHeaders().getFirst("Retry-After")).isNull();
        assertThat(REQUESTS).as("one try and one retry").hasSize(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM barcode_cache", Integer.class)).isZero();
    }

    @Test
    void clientErrorsFromUpstreamAreNotRetried() {
        for (int status : new int[] {403, 429}) {
            String code = code(40 + status % 10);
            script(code, json(status, "no"), json(200, product(code)));
            expect(code, 503, "upstream_unavailable");
        }
        assertThat(REQUESTS).hasSize(2);
    }

    @Test
    void aRetryThatFindsNoTokenLeftGivesUpAsUnavailable() {
        for (int i = 50; i < 52; i++) {
            script(code(i), json(200, product(code(i))));
            ok(code(i));
        }
        script(code(52), json(500, "x"), json(200, product(code(52))));
        expect(code(52), 503, "upstream_unavailable");
        assertThat(REQUESTS).as("two hits and one failed try; no retry without a token").hasSize(3);
    }

    @Test
    void aSlowAnswerTimesOutThenRetriesThenIs503() {
        String code = code(60);
        MockResponse.Builder slow = new MockResponse.Builder().code(200).body(product(code)).headersDelay(1500, TimeUnit.MILLISECONDS);
        script(code, slow.build(), slow.build());
        long start = System.nanoTime();
        expect(code, 503, "upstream_unavailable");
        assertThat(REQUESTS).hasSize(2);
        assertThat(Duration.ofNanos(System.nanoTime() - start)).as("bounded by two read timeouts").isLessThan(Duration.ofSeconds(5));
    }

    @Test
    void aBodyThatDripsInSlowlyIsCutOffAtTheTotalTimeout() {
        String code = code(61);
        MockResponse.Builder drip = new MockResponse.Builder().code(200).body(product(code) + " ".repeat(3000))
                .throttleBody(100, 100, TimeUnit.MILLISECONDS);
        script(code, drip.build(), drip.build());
        long start = System.nanoTime();
        expect(code, 503, "upstream_unavailable");
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(5));
    }

    @Test
    void anOversizeBodyIs503WithoutARetry() {
        String code = code(62);
        script(code, json(200, product(code) + " ".repeat(5000)));
        expect(code, 503, "upstream_unavailable");
        assertThat(REQUESTS).hasSize(1);
    }

    @Test
    void aBodyThatIsNotJsonOrHasNoStatusIs503WithoutARetry() {
        script(code(63), json(200, "<html>oops</html>"));
        script(code(64), json(200, "{\"hello\":1}"));
        expect(code(63), 503, "upstream_unavailable");
        expect(code(64), 503, "upstream_unavailable");
        assertThat(REQUESTS).hasSize(2);
    }

    @Test
    void aRedirectIsNotFollowed() {
        String code = code(65);
        script(code, new MockResponse.Builder().code(302).addHeader("Location", "http://127.0.0.1:1/evil").build());
        expect(code, 503, "upstream_unavailable");
        assertThat(REQUESTS).hasSize(1);
    }

    @Test
    void concurrentRequestsForOneCodeShareOneUpstreamCall() throws Exception {
        String code = code(66);
        MockResponse.Builder slow = new MockResponse.Builder().code(200).body(product(code)).headersDelay(300, TimeUnit.MILLISECONDS);
        script(code, slow.build());
        ExecutorService pool = Executors.newFixedThreadPool(5);
        try {
            List<Future<ResponseEntity<String>>> calls = new ArrayList<>();
            for (int i = 0; i < 5; i++) {
                calls.add(pool.submit(() -> get(code)));
            }
            for (Future<ResponseEntity<String>> f : calls) {
                assertThat(f.get(10, TimeUnit.SECONDS).getStatusCode().value()).isEqualTo(200);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(REQUESTS).hasSize(1);
    }

    @Test
    void theBarcodeAppearsInNoApplicationLogLine() {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        Level before = root.getLevel();
        var lines = new ch.qos.logback.core.read.ListAppender<ILoggingEvent>();
        lines.start();
        root.addAppender(lines);
        root.setLevel(Level.DEBUG);
        String hit = code(70), miss = code(71), down = code(72), invalid = "8901491101838";
        script(hit, json(200, product(hit)));
        script(miss, json(404, NOT_FOUND));
        script(down, json(500, "x"), json(500, "x"));
        try {
            get(hit);
            get(hit); // from the cache
            get(miss);
            get(down);
            get(invalid);
            get(code(73)); // no script left: 418, treated as unavailable
        } finally {
            root.setLevel(before);
            root.detachAppender(lines);
        }
        // The test's own HTTP client and the fake server see the URL by nature; the application's loggers must not.
        List<ILoggingEvent> app = lines.list.stream().filter(e -> !e.getLoggerName().startsWith("org.springframework.web.client")
                && !e.getLoggerName().startsWith("org.springframework.http.client")
                && !e.getLoggerName().toLowerCase().contains("okhttp")
                && !e.getLoggerName().toLowerCase().contains("mockwebserver")
                && !e.getLoggerName().startsWith("org.springframework.test")).toList();
        assertThat(app.stream().filter(e -> e.getFormattedMessage().contains("Open Food Facts lookup")).count()).isGreaterThanOrEqualTo(3);
        for (String barcode : new String[] {hit, miss, down, invalid, code(73)}) {
            assertThat(app.stream()
                            .filter(e -> e.getFormattedMessage().contains(barcode)
                                    || (e.getThrowableProxy() != null && ThrowableProxyUtil.asString(e.getThrowableProxy()).contains(barcode)))
                            .map(e -> e.getLevel() + " " + e.getLoggerName() + ": " + e.getFormattedMessage())
                            .toList())
                    .as("log lines holding " + barcode)
                    .isEmpty();
        }
    }
}
