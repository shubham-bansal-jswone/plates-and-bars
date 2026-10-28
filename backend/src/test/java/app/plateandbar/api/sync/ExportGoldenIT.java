package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;

/**
 * The bytes of {@code GET /me/export} for a fixed account are pinned in {@code golden/me-export.json}, which was
 * written by the original in-memory implementation. The streamed writer must reproduce them exactly. Row ids, seq
 * values (with ties across a page boundary: the page size is 2 here, so a tie of three rows spans a boundary) and the clock are fixed so the bytes are stable.
 */
@org.springframework.test.context.TestPropertySource(properties = "app.export.page-size=2")
class ExportGoldenIT extends SyncITBase {

    static final String USER = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

    private void row(String table, String id, int version, String updated, String deleted, long seq, String data) {
        jdbc.update(
                "INSERT INTO " + table + " (user_id, id, version, updated_at, deleted_at, seq, data)"
                        + " VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))",
                USER, id, version, updated, deleted, seq, data);
    }

    static String rid(int n) {
        return String.format("00000000-0000-4000-8000-%012d", n);
    }

    private void seed() {
        jdbc.update("INSERT INTO users (id, email, created_at) VALUES (?, ?, '2026-10-01 06:30:00.250')", USER, "Zoe-ü@example.com");
        for (int i = 0; i < 7; i++) { // seq ties: ids break them
            row("water_logs", rid(7 - i), 1 + i, "2026-10-08 11:00:00.500", null, 3 + i / 3,
                    "{\"date\":\"2026-10-08\",\"ml\":" + (250 + i) + ",\"t\":\"2026-10-08T11:00:00Z\"}");
        }
        row("water_logs", rid(100), 3, "2026-10-08 11:30:00.000", "2026-10-08 11:30:00.000", 20,
                "{\"date\":\"2026-10-08\",\"ml\":0,\"t\":\"2026-10-08T11:00:00Z\"}");
        row("food_logs", rid(200), 1, "2026-10-08 11:00:00.000", null, 1,
                "{\"name\":\"Poha \\\"special\\\" \\u00fc \\ud83c\\udf5b\",\"kcal\":291.5,\"protein_g\":6,\"meal\":\"b\",\"qty\":1}");
        row("weights", rid(300), 2, "2026-10-07 05:00:00.000", null, 2, "{\"date\":\"2026-10-07\",\"kg\":62.5}");
        row("settings", rid(400), 1, "2026-10-08 06:00:00.000", null, 9, "{\"unit\":\"kg\",\"nested\":{\"b\":[1,2,{\"c\":null}],\"a\":true}}");
        row("routines", rid(500), 2, "2026-10-08 07:00:00.000", "2026-10-08 08:00:00.000", 10,
                "{\"name\":\"Upper \\u00fc\",\"exercises\":[{\"name\":\"Squat\",\"sets\":3,\"group\":\"a\"}],\"created_at\":\"2026-10-08T06:00:00Z\"}");
        jdbc.update(
                "INSERT INTO sync_conflicts (user_id, table_name, record_id, loser, version, winner_version, updated_at,"
                        + " deleted_at, record, logged_at) VALUES (?, 'water_logs', ?, 'client', 1, 2, '2026-10-08 10:00:00.000',"
                        + " NULL, CAST('{\"ml\":100}' AS JSON), '2026-10-08 11:00:01.000')",
                USER, rid(1));
        jdbc.update(
                "INSERT INTO sync_conflicts (user_id, table_name, record_id, loser, version, winner_version, updated_at,"
                        + " deleted_at, record, logged_at) VALUES (?, 'food_logs', ?, 'server', 2, 3, '2026-10-08 10:00:00.000',"
                        + " '2026-10-08 10:30:00.000', CAST('{\"name\":\"x\"}' AS JSON), '2026-10-08 11:05:00.000')",
                USER, rid(200));
    }

    @Test
    void exportBytesAreTheGoldenBytes() throws Exception {
        seed();
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(jwt.issue(USER).value());
        byte[] got = http.exchange("/api/v1/me/export", HttpMethod.GET, new HttpEntity<>(h), byte[].class).getBody();
        Path golden = Path.of("src/test/resources/golden/me-export.json");
        if (System.getenv("GOLDEN_WRITE") != null) {
            Files.write(golden, got);
        }
        assertThat(new String(got, StandardCharsets.UTF_8))
                .isEqualTo(new String(Files.readAllBytes(golden), StandardCharsets.UTF_8));
        assertThat(got).isEqualTo(Files.readAllBytes(golden));
    }
}
