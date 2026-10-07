package app.plateandbar.api.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Boots a real MySQL 8, lets Flyway run the migrations, and calls /health over HTTP. */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthMigrationIT {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", MYSQL::getJdbcUrl);
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
    }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;

    @Test
    void migrationsCreateBaselineTablesAndHealthIsOk() {
        List<String> tables = jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()", String.class);
        assertThat(tables).contains("users", "auth_identities", "refresh_tokens", "flyway_schema_history");

        ResponseEntity<String> res = http.getForEntity("/api/v1/health", String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("\"status\":\"ok\"").contains("\"version\":\"0.1.0\"");
    }

    @Test
    void identityKeysAreCaseAndAccentSensitive() {
        String sql = "INSERT INTO users (id, email) VALUES (?, ?)";
        jdbc.update(sql, "00000000-0000-0000-0000-000000000001", "jose@x");
        jdbc.update(sql, "00000000-0000-0000-0000-000000000002", "jos\u00e9@x");

        String ident = "INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES (?, ?, ?, ?)";
        String u1 = "00000000-0000-0000-0000-000000000001";
        jdbc.update(ident, "10000000-0000-0000-0000-000000000001", u1, "google", "AbC");
        jdbc.update(ident, "10000000-0000-0000-0000-000000000002", u1, "google", "abc");
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                        jdbc.update(ident, "10000000-0000-0000-0000-000000000003", u1, "google", "AbC"))
                .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
    }
}
