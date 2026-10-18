package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * The contract layer's guard (#834): every operation in {@code packages/api/openapi.yaml} has at least one test that
 * checks a real response with {@code ContractSchemas.assertResponse("METHOD /path", status, body)}. It reads the test
 * sources for those literal calls, so removing a test's validation makes this fail. {@code /auth/*} and
 * {@code /content/*} must be covered for every documented status, not just one.
 */
class ContractCoverageTest {

    /** Operations with no schema-checked test, and why. Nothing else may be listed. */
    static final Map<String, String> ALLOWLIST =
            Map.of("GET /foods", "in the contract but deliberately not built for v1 (#200, decision 2)");

    private static final Pattern CALL = Pattern.compile("assertResponse\\(\\s*\"([A-Z]+ /[^\"]*)\"\\s*,\\s*(\\d{3})");
    private static final Path TESTS = Path.of("src", "test", "java");

    private static Set<String> checked() throws IOException {
        Set<String> out = new TreeSet<>();
        try (Stream<Path> files = Files.walk(TESTS)) {
            for (Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java")
                    && !p.getFileName().toString().equals("ContractSchemas.java"))::iterator) {
                Matcher m = CALL.matcher(Files.readString(f));
                while (m.find()) {
                    out.add(m.group(1) + " " + m.group(2));
                }
            }
        }
        return out;
    }

    @Test
    void everyContractOperationHasASchemaCheckedTest() throws IOException {
        Set<String> checked = checked();
        Set<String> missing = new TreeSet<>();
        ContractSchemas.paths().properties().forEach(path -> path.getValue().properties().forEach(op -> {
            String name = op.getKey().toUpperCase() + " " + path.getKey();
            if (!ALLOWLIST.containsKey(name) && checked.stream().noneMatch(c -> c.startsWith(name + " "))) {
                missing.add(name);
            }
        }));
        assertThat(missing).as("operations without a ContractSchemas.assertResponse test").isEmpty();
    }

    @Test
    void authAndContentAreCheckedForEveryDocumentedStatus() throws IOException {
        Set<String> checked = checked();
        Set<String> missing = new TreeSet<>();
        ContractSchemas.paths().properties().stream()
                .filter(p -> p.getKey().startsWith("/auth/") || p.getKey().startsWith("/content/"))
                .forEach(path -> path.getValue().properties().forEach(op ->
                        op.getValue().path("responses").properties().forEach(r -> {
                            String name = op.getKey().toUpperCase() + " " + path.getKey() + " " + r.getKey();
                            if (!checked.contains(name)) {
                                missing.add(name);
                            }
                        })));
        assertThat(missing).as("documented statuses without a ContractSchemas.assertResponse test").isEmpty();
    }

    @Test
    void theAllowlistHoldsOnlyOperationsThatExist() {
        JsonNode paths = ContractSchemas.paths();
        ALLOWLIST.keySet().forEach(k -> {
            String[] p = k.split(" ");
            assertThat(paths.path(p[1]).path(p[0].toLowerCase()).isMissingNode()).as(k).isFalse();
        });
        assertThat(ALLOWLIST.keySet()).containsExactly("GET /foods");
    }
}
