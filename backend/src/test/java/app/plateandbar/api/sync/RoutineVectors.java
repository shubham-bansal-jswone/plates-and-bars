package app.plateandbar.api.sync;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;

/** Loads the contract's routine vectors ({@code packages/api/test-vectors/routines.json}). */
final class RoutineVectors {
    static final JsonNode FILE = read();

    private RoutineVectors() {}

    private static JsonNode read() {
        try {
            return new ObjectMapper().readTree(Files.readAllBytes(Path.of("..", "packages", "api", "test-vectors", "routines.json")));
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
