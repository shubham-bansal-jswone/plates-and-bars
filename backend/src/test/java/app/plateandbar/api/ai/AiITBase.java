package app.plateandbar.api.ai;

import app.plateandbar.api.auth.JwtService;
import app.plateandbar.api.support.MutableClock;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;

/** One real MySQL 8 for every AI integration test, a settable clock and HTTP helpers. */
abstract class AiITBase {

    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4");

    static {
        MYSQL.start();
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

    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;
    @Autowired TestRestTemplate http;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper json;

    String newUser() {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO users (id, email) VALUES (?, ?)", id, id + "@example.com");
        return id;
    }

    int calls(String user) {
        Integer n = jdbc.queryForObject("SELECT COALESCE(SUM(calls), 0) FROM ai_usage WHERE user_id = ?", Integer.class, user);
        return n == null ? 0 : n;
    }

    ResponseEntity<String> get(String userId, String path) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(jwt.issue(userId).value());
        return http.exchange(path, HttpMethod.GET, new HttpEntity<>(h), String.class);
    }

    ResponseEntity<String> post(String userId, String path, String body) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        if (userId != null) {
            h.setBearerAuth(jwt.issue(userId).value());
        }
        return http.exchange(path, HttpMethod.POST, new HttpEntity<>(body, h), String.class);
    }
}
