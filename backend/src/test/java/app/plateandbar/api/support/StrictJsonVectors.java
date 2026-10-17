package app.plateandbar.api.support;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** The shared strict-JSON vectors of the contract ({@code packages/api/test-vectors/strict-json.json}) for one path. */
public final class StrictJsonVectors {
    private static final Path FILE = Path.of("..", "packages", "api", "test-vectors", "strict-json.json");
    private static final JsonNode ROOT;

    static {
        try {
            ROOT = new ObjectMapper().readTree(Files.readAllBytes(FILE));
        } catch (IOException e) {
            throw new IllegalStateException("run the tests from backend/ so " + FILE + " resolves", e);
        }
    }

    private StrictJsonVectors() {}

    public record Vector(String name, String path, String fault, String body) {
        @Override
        public String toString() {
            return name;
        }
    }

    public static int maxNestingDepth() {
        return ROOT.path("max_nesting_depth").asInt();
    }

    public static List<Vector> mustRefuse(String path) {
        return of("must_refuse", path);
    }

    public static List<Vector> mustAccept(String path) {
        return of("must_accept", path);
    }

    private static List<Vector> of(String kind, String path) {
        List<Vector> out = new ArrayList<>();
        for (JsonNode v : ROOT.path(kind)) {
            if (path.equals(v.path("path").asString())) {
                out.add(new Vector(v.path("name").asString(), path, v.path("fault").asString(null), v.path("body").asString()));
            }
        }
        if (out.isEmpty()) {
            throw new IllegalStateException("no " + kind + " vectors for " + path);
        }
        return out;
    }
}
