package app.plateandbar.api.foods;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** The contract's barcode vectors (packages/api/test-vectors/barcode-gs1.json) against the server's check. */
class Gs1Test {

    private static JsonNode vectors() throws Exception {
        return new ObjectMapper().readTree(Files.readAllBytes(Path.of("..", "packages", "api", "test-vectors", "barcode-gs1.json")));
    }

    @Test
    void everyValidVectorPasses() throws Exception {
        List<String> failed = new ArrayList<>();
        JsonNode valid = vectors().path("valid");
        assertThat(valid.size()).isGreaterThanOrEqualTo(4);
        valid.forEach(v -> { if (!Gs1.isValid(v.path("code").asString())) failed.add(v.path("code").asString()); });
        assertThat(failed).isEmpty();
    }

    @Test
    void everyInvalidVectorFails() throws Exception {
        List<String> passed = new ArrayList<>();
        JsonNode invalid = vectors().path("invalid");
        assertThat(invalid.size()).isGreaterThanOrEqualTo(10);
        invalid.forEach(v -> { if (Gs1.isValid(v.path("code").asString())) passed.add(v.path("reason").asString()); });
        assertThat(passed).isEmpty();
    }

    @Test
    void nullIsInvalid() {
        assertThat(Gs1.isValid(null)).isFalse();
    }
}
