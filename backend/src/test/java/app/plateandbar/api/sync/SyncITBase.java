package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.MutableClock;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;

/**
 * Real MySQL 8 (one container shared by every subclass), real Flyway, real HTTP through the real security
 * chain. The clock is settable; every request is signed with a fresh token for the user it names.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.rate-limit.public-per-ip.capacity=100000",
            "app.rate-limit.authenticated-per-user.capacity=100000"
        })
@org.springframework.context.annotation.Import(SyncITBase.Config.class)
abstract class SyncITBase {

    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4");

    static {
        MYSQL.start(); // stopped by Testcontainers' reaper when the JVM exits
    }

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
    }

    static final Instant START = Instant.parse("2026-10-08T12:00:00Z");

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(START);
        }
    }

    record Resp(int status, JsonNode body) {}

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper json;

    @BeforeEach
    void resetClock() {
        clock.advance(java.time.Duration.between(clock.instant(), START));
    }

    String newUser() {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO users (id, email) VALUES (?, ?)", id, id + "@example.com");
        return id;
    }

    Resp post(String userId, JsonNode body) {
        return post(jwt.issue(userId).value(), body.toString());
    }

    Resp post(String token, String rawBody) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            h.setBearerAuth(token);
        }
        ResponseEntity<String> res = http.postForEntity("/api/v1/sync", new HttpEntity<>(rawBody, h), String.class);
        try {
            return new Resp(res.getStatusCode().value(), json.readTree(res.getBody()));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Syncs and asserts HTTP 200. */
    Resp ok(String userId, JsonNode body) {
        Resp r = post(userId, body);
        assertThat(r.status()).as(r.body().toString()).isEqualTo(200);
        return r;
    }

    int count(String sql, Object... args) {
        Integer n = jdbc.queryForObject(sql, Integer.class, args);
        return n == null ? 0 : n;
    }

    static String iso(Instant t) {
        return java.time.format.DateTimeFormatter.ISO_INSTANT.format(t);
    }
}
