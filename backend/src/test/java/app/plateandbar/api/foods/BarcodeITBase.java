package app.plateandbar.api.foods;

import app.plateandbar.api.support.MutableClock;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import mockwebserver3.Dispatcher;
import mockwebserver3.MockResponse;
import mockwebserver3.MockWebServer;
import mockwebserver3.RecordedRequest;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.mysql.MySQLContainer;

/**
 * Real MySQL 8 (migrations through Flyway), the real security chain over HTTP, and a fake Open Food Facts server (no live
 * calls). The fake answers each barcode from a script of canned responses; it records every request it receives.
 * The clock is settable and moves forward 5 minutes before each test, so every rate-limit bucket starts full.
 */
@AutoConfigureTestRestTemplate
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.context.annotation.Import(BarcodeITBase.Config.class)
abstract class BarcodeITBase {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4");
    static final MockWebServer OFF = new MockWebServer();
    static final Map<String, Queue<MockResponse>> SCRIPT = new ConcurrentHashMap<>();
    static final List<RecordedRequest> REQUESTS = new CopyOnWriteArrayList<>();

    static {
        MYSQL.start(); // stopped by Testcontainers' reaper when the JVM exits
        OFF.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                REQUESTS.add(request);
                String path = request.getUrl().encodedPath();
                Queue<MockResponse> script = SCRIPT.get(path.substring(path.lastIndexOf('/') + 1));
                MockResponse next = script == null ? null : script.poll();
                // A code with no script left is a test bug: a loud 418 that no mapping treats as a hit or a miss.
                return next != null ? next : new MockResponse.Builder().code(418).build();
            }
        });
        try {
            OFF.start();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
        r.add("app.off.base-url", () -> "http://" + OFF.getHostName() + ":" + OFF.getPort());
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(Instant.parse("2026-10-18T12:00:00Z"));
        }
    }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;

    @BeforeEach
    void reset() {
        SCRIPT.clear();
        REQUESTS.clear();
        jdbc.update("DELETE FROM barcode_cache");
        clock.advance(Duration.ofMinutes(5));
    }

    /** A valid EAN-13 for {@code n} (12 digits then the GS1 check digit); distinct n give distinct codes. */
    static String code(int n) {
        String body = String.format("890%09d", n);
        int sum = 0;
        for (int i = 0; i < 12; i++) {
            sum += (body.charAt(i) - '0') * (i % 2 == 0 ? 1 : 3);
        }
        return body + (10 - sum % 10) % 10;
    }

    static void script(String code, MockResponse... responses) {
        SCRIPT.computeIfAbsent(code, k -> new ConcurrentLinkedQueue<>()).addAll(List.of(responses));
    }

    static MockResponse json(int status, String body) {
        return new MockResponse.Builder().code(status).addHeader("Content-Type", "application/json").body(body).build();
    }

    static String product(String codeFromUpstream) {
        return """
                {"code":"%s","status":1,"status_verbose":"product found","product":{"code":"%s","product_name":"Test bar","brands":"Brand",
                 "quantity":"45g","serving_size":"1 bar (45 g)","serving_quantity":45,"nutrition_data_per":"serving","completeness":0.9,
                 "last_modified_t":1780391671,"states_tags":["en:nutrition-facts-completed"],"data_quality_errors_tags":[],
                 "countries_tags":["en:united-kingdom"],"nutriments":{"energy-kcal_100g":534,"proteins_100g":7.6,"carbohydrates_100g":57,
                 "fat_100g":30,"energy":2234,"sugars_100g":54}}}
                """.formatted(codeFromUpstream, codeFromUpstream);
    }

    static final String NOT_FOUND = "{\"status\":0,\"status_verbose\":\"product not found\"}";

    ResponseEntity<String> get(String code) {
        return http.getForEntity("/api/v1/foods/barcode/" + code, String.class);
    }
}
