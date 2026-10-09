package app.plateandbar.api.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ContentBundlesTest {

    static final ObjectMapper JSON = new ObjectMapper();

    static JsonNode vectors() throws Exception {
        return JSON.readTree(Files.readAllBytes(Path.of("..", "packages", "api", "test-vectors", "content-hash.json")));
    }

    @Test
    void sharedVectorsGiveTheSameSha256SizeAndEtag() throws Exception {
        JsonNode cases = vectors().path("cases");
        assertThat(cases.size()).isGreaterThanOrEqualTo(6);
        for (JsonNode c : cases) {
            byte[] bytes = HexFormat.of().parseHex(c.path("utf8_hex").asText());
            assertThat(bytes).as(c.path("note").asText()).isEqualTo(c.path("text").asText().getBytes(StandardCharsets.UTF_8));
            assertThat(bytes.length).isEqualTo(c.path("size_bytes").asInt());
            assertThat(ContentBundles.sha256(bytes)).as(c.path("note").asText()).isEqualTo(c.path("sha256").asText());
            assertThat("\"" + ContentBundles.sha256(bytes) + "\"").isEqualTo(c.path("etag").asText());
        }
    }

    @Test
    void servedBundlesUseTheExactBytesAndVectorHashes() throws Exception {
        for (JsonNode c : vectors().path("cases")) {
            byte[] bytes = c.path("text").asText().getBytes(StandardCharsets.UTF_8);
            JsonNode parsed = bytes.length == 0 || c.path("text").asText().equals("abc") ? null : JSON.readTree(bytes);
            if (parsed == null) {
                continue; // not a servable bundle (empty, not JSON)
            }
            ContentBundles b = new ContentBundles(JSON, Map.of("b", bytes), "b=2026-01-02T03:04:05Z");
            assertThat(b.bundle("b").body()).isEqualTo(bytes);
            assertThat(b.bundle("b").etag()).isEqualTo(c.path("etag").asText());
            ContentBundles.Info info = b.infos().get(0);
            assertThat(info.sha256()).isEqualTo(c.path("sha256").asText());
            assertThat(info.sizeBytes()).isEqualTo(c.path("size_bytes").asInt());
        }
    }

    @Test
    void manifestIsSortedByNameWithOffsetsConvertedToUtcAndEtagOfItsBody() throws Exception {
        byte[] a = "{\"schema_version\":2}".getBytes(StandardCharsets.UTF_8);
        byte[] z = "{\"schema_version\":1}\n".getBytes(StandardCharsets.UTF_8);
        ContentBundles b = new ContentBundles(
                JSON,
                Map.of("zeta", z, "alpha", a, "meal-planning", z),
                "zeta=2026-10-09T14:24:10+05:30, alpha=2026-10-09T08:54:10Z,meal-planning=2026-10-09T08:54:10.123Z");
        JsonNode m = JSON.readTree(b.manifest().body());
        assertThat(m.fieldNames()).toIterable().containsExactly("bundles");
        assertThat(m.path("bundles").findValuesAsText("name")).containsExactly("alpha", "meal-planning", "zeta");
        assertThat(m.path("bundles").get(0).fieldNames()).toIterable()
                .containsExactly("name", "schema_version", "sha256", "size_bytes", "updated_at");
        assertThat(m.path("bundles").get(0).path("schema_version").asInt()).isEqualTo(2);
        assertThat(m.path("bundles").get(2).path("updated_at").asText()).isEqualTo("2026-10-09T08:54:10Z");
        assertThat(m.path("bundles").get(1).path("updated_at").asText()).isEqualTo("2026-10-09T08:54:10Z");
        assertThat(b.manifest().etag()).isEqualTo("\"" + ContentBundles.sha256(b.manifest().body()) + "\"");
    }

    @Test
    void aBundleWithoutAnUpdatedAtStopsStartup() {
        byte[] ok = "{\"schema_version\":1}".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", ok, "b", ok), "a=2026-01-01T00:00:00Z"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("content/b.json");
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", ok), ""))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", ok), null))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void badTimestampsAndBadFilesStopStartup() {
        byte[] ok = "{\"schema_version\":1}".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", ok), "a=yesterday")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", ok), "a=2026-01-01T00:00:00Z,a=2026-01-01T00:00:00Z"))
                .isInstanceOf(IllegalStateException.class);
        String stamp = "a=2026-01-01T00:00:00Z";
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", new byte[0]), stamp)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", "[]".getBytes(StandardCharsets.UTF_8)), stamp))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("a", "{\"schema_version\":0}".getBytes(StandardCharsets.UTF_8)), stamp))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("A_b", ok), "A_b=2026-01-01T00:00:00Z"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new ContentBundles(JSON, Map.of("manifest", ok), "manifest=2026-01-01T00:00:00Z"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void unknownBundleIsNull() {
        byte[] ok = "{\"schema_version\":1}".getBytes(StandardCharsets.UTF_8);
        assertThat(new ContentBundles(JSON, Map.of("a", ok), "a=2026-01-01T00:00:00Z").bundle("b")).isNull();
    }
}
