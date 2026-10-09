package app.plateandbar.api.sync;

import static app.plateandbar.api.sync.SyncFixtures.Req;
import static app.plateandbar.api.sync.SyncFixtures.id;
import static app.plateandbar.api.sync.SyncFixtures.waterLog;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;

/**
 * DELETE /me and GET /me/export on real MySQL through the real security chain. Lives in the sync test package
 * to share its container and fixtures.
 */
class AccountRightsIT extends SyncITBase {

    static final String MID = "2026-10-08T11:00:00Z";
    static final String NEW = "2026-10-08T11:30:00Z";

    private ResponseEntity<String> call(HttpMethod method, String path, String token) {
        HttpHeaders h = new HttpHeaders();
        if (token != null) {
            h.setBearerAuth(token);
        }
        return http.exchange(path, method, new HttpEntity<>(h), String.class);
    }

    /** Seeds every table the schema has for the user; returns the one-of-each records it pushed. */
    private Map<SyncTable, com.fasterxml.jackson.databind.node.ObjectNode> seed(String user, String email) {
        jdbc.update("UPDATE users SET email = ? WHERE id = ?", email, user);
        Req push = Req.of(null);
        Map<SyncTable, com.fasterxml.jackson.databind.node.ObjectNode> pushed = SyncFixtures.oneOfEach(user, MID);
        pushed.forEach(push::add);
        ok(user, push.build());
        String rid = id();
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 0, NEW, null, 250)).build());
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(rid, 0, MID, null, 300)).build()); // conflict
        ok(user, Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, MID, 100)).build()); // tombstone
        jdbc.update(
                "INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES (?, ?, 'email', ?)",
                id(), user, email);
        jdbc.update(
                "INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES (?, ?, 'google', ?)",
                id(), user, "g-" + user);
        jdbc.update(
                "INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
                id(), user, id(), (user + "0".repeat(64)).substring(0, 64), java.time.LocalDateTime.of(2027, 1, 1, 0, 0));
        jdbc.update(
                "INSERT INTO email_sign_in_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
                email, "0".repeat(64), java.time.LocalDateTime.of(2027, 1, 1, 0, 0), java.time.LocalDateTime.of(2026, 1, 1, 0, 0));
        jdbc.update("INSERT INTO email_verify_failures (email, failed_at) VALUES (?, ?)", email,
                java.time.LocalDateTime.of(2026, 1, 1, 0, 0));
        return pushed;
    }

    private record Owner(String table, String column) {}

    /** Every table of the schema except Flyway's and users, with the column that ties its rows to one user. */
    private List<Owner> userDataTables() {
        List<Owner> owners = new ArrayList<>();
        for (String t : jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
                        + " AND table_type = 'BASE TABLE' AND table_name NOT IN ('flyway_schema_history', 'users')",
                String.class)) {
            List<String> cols = jdbc.queryForList(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
                    String.class, t);
            if (cols.contains("user_id")) {
                owners.add(new Owner(t, "user_id"));
            } else if (cols.contains("email")) {
                owners.add(new Owner(t, "email"));
            } else {
                throw new AssertionError("Table " + t + " is neither keyed by user_id nor email: decide how DELETE /me"
                        + " clears it, then teach this test");
            }
        }
        return owners;
    }

    private int rows(Owner o, String user, String email) {
        return count("SELECT COUNT(*) FROM " + o.table() + " WHERE " + o.column() + " = ?",
                o.column().equals("user_id") ? user : email);
    }

    @Test
    void deleteRemovesEveryRowOfTheUserAndNoneOfAnotherUser() {
        String a = newUser();
        String b = newUser();
        String aMail = "a-" + a + "@example.com";
        String bMail = "b-" + b + "@example.com";
        seed(a, aMail);
        seed(b, bMail);
        List<Owner> owners = userDataTables();
        assertThat(owners.size()).isGreaterThanOrEqualTo(SyncTable.values().length + 6);
        Map<Owner, Integer> bBefore = new java.util.HashMap<>();
        for (Owner o : owners) {
            assertThat(rows(o, a, aMail)).as("seeded " + o.table() + " for A").isPositive();
            bBefore.put(o, rows(o, b, bMail));
            assertThat(bBefore.get(o)).as("seeded " + o.table() + " for B").isPositive();
        }

        assertThat(call(HttpMethod.DELETE, "/api/v1/me", jwt.issue(a).value()).getStatusCode().value()).isEqualTo(204);

        for (Owner o : owners) {
            assertThat(rows(o, a, aMail)).as(o.table() + " rows left for A").isZero();
            assertThat(rows(o, b, bMail)).as(o.table() + " rows of B").isEqualTo(bBefore.get(o));
        }
        assertThat(count("SELECT COUNT(*) FROM users WHERE id = ?", a)).isZero();
        assertThat(count("SELECT COUNT(*) FROM users WHERE id = ?", b)).isEqualTo(1);
    }

    @Test
    void tokensIssuedBeforeDeletionAreRefusedEverywhereAndARepeatDeleteIs204() {
        String a = newUser();
        String b = newUser();
        String token = jwt.issue(a).value();
        assertThat(call(HttpMethod.GET, "/api/v1/me/export", token).getStatusCode().value()).isEqualTo(200);

        assertThat(call(HttpMethod.DELETE, "/api/v1/me", token).getStatusCode().value()).isEqualTo(204);

        ResponseEntity<String> export = call(HttpMethod.GET, "/api/v1/me/export", token);
        assertThat(export.getStatusCode().value()).isEqualTo(401);
        assertThat(export.getBody()).contains("\"unauthorized\"");
        Resp sync = post(token, Req.of(null).build().toString());
        assertThat(sync.status()).isEqualTo(401);
        assertThat(sync.body().path("code").asText()).isEqualTo("unauthorized");
        assertThat(count("SELECT COUNT(*) FROM sync_state WHERE user_id = ?", a)).isZero();

        assertThat(call(HttpMethod.DELETE, "/api/v1/me", token).getStatusCode().value()).isEqualTo(204);
        // Another user's token is unaffected.
        assertThat(call(HttpMethod.GET, "/api/v1/me/export", jwt.issue(b).value()).getStatusCode().value()).isEqualTo(200);
        // An expired token is not exempt: 401 token_expired, as everywhere.
        clock.advance(java.time.Duration.ofMinutes(16));
        ResponseEntity<String> late = call(HttpMethod.DELETE, "/api/v1/me", token);
        assertThat(late.getStatusCode().value()).isEqualTo(401);
        assertThat(late.getBody()).contains("token_expired");
    }

    @Test
    void refreshTokensDieWithTheAccount() {
        String a = newUser();
        seed(a, "r-" + a + "@example.com");
        call(HttpMethod.DELETE, "/api/v1/me", jwt.issue(a).value());
        assertThat(count("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?", a)).isZero();
    }

    @Test
    void exportReturnsEverythingSeededAndConformsToTheContract() throws Exception {
        String a = newUser();
        String b = newUser();
        String aMail = "a-" + a + "@example.com";
        Map<SyncTable, com.fasterxml.jackson.databind.node.ObjectNode> pushed = seed(a, aMail);
        seed(b, "b-" + b + "@example.com");

        ResponseEntity<String> res = call(HttpMethod.GET, "/api/v1/me/export", jwt.issue(a).value());
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getHeaders().getFirst("Cache-Control")).isEqualTo("no-store");
        assertThat(res.getHeaders().getFirst("Content-Disposition"))
                .isEqualTo("attachment; filename=\"plate-and-bar-export-2026-10-08.json\"");
        JsonNode out = json.readTree(res.getBody());

        assertThat(ContractSchemas.validate("MeExport", out)).isEmpty();
        assertThat(out.path("format_version").asInt()).isEqualTo(1);
        assertThat(out.path("exported_at").asText()).isEqualTo(iso(START));
        assertThat(out.path("user").path("id").asText()).isEqualTo(a);
        assertThat(out.path("user").path("email").asText()).isEqualTo(aMail);

        // Every table present; each seeded record comes back with its fields, stored version 1.
        assertThat(out.path("tables").size()).isEqualTo(SyncTable.values().length);
        for (SyncTable t : SyncTable.values()) {
            JsonNode rows = out.path("tables").path(t.name());
            assertThat(rows.isArray()).as(t.name()).isTrue();
            JsonNode sent = pushed.get(t);
            JsonNode got = null;
            for (JsonNode r : rows) {
                if (r.path("id").asText().equals(sent.path("id").asText())) {
                    got = r;
                }
            }
            assertThat(got).as("seeded " + t.name()).isNotNull();
            assertThat(got.path("version").asInt()).isEqualTo(1);
            var fields = sent.fieldNames();
            while (fields.hasNext()) {
                String f = fields.next();
                if (!f.equals("version")) {
                    assertThat(JsonContent.same(sent.get(f), got.get(f))).as(t + "." + f).isTrue();
                }
            }
        }
        // Water logs: the pushed one, the conflict's winner and a tombstone (deleted_at set), A's only.
        JsonNode water = out.path("tables").path("water_logs");
        assertThat(water).hasSize(3);
        assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", a)).isEqualTo(3);
        long tombstones = 0;
        for (JsonNode w : water) {
            if (!w.path("deleted_at").isNull()) {
                tombstones++;
            }
        }
        assertThat(tombstones).isEqualTo(1);

        JsonNode log = out.path("conflict_log");
        assertThat(log).hasSize(1);
        assertThat(log.get(0).path("table").asText()).isEqualTo("water_logs");
        assertThat(log.get(0).path("loser").asText()).isEqualTo("client");
        assertThat(log.get(0).path("winner_version").asInt()).isEqualTo(1);
        assertThat(log.get(0).path("record").path("ml").asInt()).isEqualTo(300);
        assertThat(Instant.parse(log.get(0).path("logged_at").asText())).isEqualTo(START);
        // Nothing of B's.
        assertThat(res.getBody()).doesNotContain(b);
        // No credentials.
        assertThat(res.getBody()).doesNotContain("token_hash").doesNotContain("code_hash");
    }

    @Test
    void emptyUserExportsEverySetOfRowsAsAnEmptyArray() throws Exception {
        String a = newUser();
        JsonNode out = json.readTree(call(HttpMethod.GET, "/api/v1/me/export", jwt.issue(a).value()).getBody());
        assertThat(ContractSchemas.validate("MeExport", out)).isEmpty();
        out.path("tables").forEach(rows -> assertThat(rows).isEmpty());
        assertThat(out.path("conflict_log")).isEmpty();
    }

    @Test
    void sixthExportInAnHourIsRefusedAndRecoversLater() {
        String a = newUser();
        String token = jwt.issue(a).value();
        for (int i = 0; i < 5; i++) {
            assertThat(call(HttpMethod.GET, "/api/v1/me/export", token).getStatusCode().value()).isEqualTo(200);
        }
        ResponseEntity<String> sixth = call(HttpMethod.GET, "/api/v1/me/export", token);
        assertThat(sixth.getStatusCode().value()).isEqualTo(429);
        assertThat(sixth.getHeaders().getFirst("Retry-After")).isNotNull();
        assertThat(sixth.getBody()).contains("rate_limited");
        // Another user is not affected.
        assertThat(call(HttpMethod.GET, "/api/v1/me/export", jwt.issue(newUser()).value()).getStatusCode().value())
                .isEqualTo(200);
        clock.advance(java.time.Duration.ofMinutes(13));
        assertThat(call(HttpMethod.GET, "/api/v1/me/export", jwt.issue(a).value()).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void aSyncRacingADeleteIs200OrCleanly401NeverA500AndNeverDeadlocks() throws Exception {
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 25; round++) {
                String a = newUser();
                String token = jwt.issue(a).value();
                String body = Req.of(null).add(SyncTable.water_logs, waterLog(id(), 0, MID, null, 250)).build().toString();
                java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
                var sync = pool.submit(() -> {
                    go.await();
                    return post(token, body).status();
                });
                var del = pool.submit(() -> {
                    go.await();
                    return call(HttpMethod.DELETE, "/api/v1/me", token).getStatusCode().value();
                });
                go.countDown();
                assertThat(del.get(20, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(204);
                assertThat(sync.get(20, java.util.concurrent.TimeUnit.SECONDS)).isIn(200, 401);
                assertThat(count("SELECT COUNT(*) FROM water_logs WHERE user_id = ?", a)).isZero();
                assertThat(count("SELECT COUNT(*) FROM sync_state WHERE user_id = ?", a)).isZero();
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
