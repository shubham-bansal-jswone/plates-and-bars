package app.plateandbar.api.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * The contract layer's guard (#834). Classes run in {@code @Order} (see {@code junit-platform.properties}) and this
 * one is last, so {@link ContractSchemas#recorded()} holds every response that passed
 * {@code ContractSchemas.assertResponse("METHOD /path", status, body)}. Every operation in
 * {@code packages/api/openapi.yaml} must be there, and every documented status of {@code /auth/*} and
 * {@code /content/*}. A test that is skipped, disabled or no longer validates leaves a gap and fails this. It
 * only enforces an unfiltered {@code ./gradlew test} ({@code contract.coverage.enforce}, set in build.gradle): a
 * {@code --tests} run executes a subset, so the gap would mean nothing.
 */
@Order(Integer.MAX_VALUE)
class ContractCoverageTest {

    /** Operations with no schema-checked test, and why. Nothing else may be listed. */
    static final Map<String, String> ALLOWLIST = Map.of(
            "GET /foods", "in the contract but deliberately not built for v1 (#200, decision 2)",
            // TODO(#944): remove when the backend proxy lands
            "GET /foods/barcode/{code}", "contract first; the Open Food Facts proxy is built in a later #944 PR");

    private static void requireUnfilteredRun() {
        if (Boolean.getBoolean("contract.coverage.enforce")) {
            return;
        }
        // On CI a filtered run would switch the guard off silently, so it fails instead of skipping.
        assertThat(System.getenv("CI")).as("CI must run the unfiltered ./gradlew test so the contract guard enforces").isNull();
        Assumptions.assumeTrue(false, "filtered run: coverage is only enforced on a full ./gradlew test");
    }

    @Test
    void everyContractOperationHasASchemaCheckedTest() {
        requireUnfilteredRun();
        Set<String> recorded = ContractSchemas.recorded();
        Set<String> missing = new TreeSet<>();
        ContractSchemas.paths().properties().forEach(path -> path.getValue().properties().forEach(op -> {
            String name = op.getKey().toUpperCase() + " " + path.getKey();
            if (!ALLOWLIST.containsKey(name) && recorded.stream().noneMatch(c -> c.startsWith(name + " "))) {
                missing.add(name);
            }
        }));
        assertThat(missing).as("operations with no passing ContractSchemas.assertResponse").isEmpty();
    }

    @Test
    void authAndContentAreCheckedForEveryDocumentedStatus() {
        requireUnfilteredRun();
        Set<String> recorded = ContractSchemas.recorded();
        Set<String> missing = new TreeSet<>();
        ContractSchemas.paths().properties().stream()
                .filter(p -> p.getKey().startsWith("/auth/") || p.getKey().startsWith("/content/"))
                .forEach(path -> path.getValue().properties().forEach(op ->
                        op.getValue().path("responses").properties().forEach(r -> {
                            String name = op.getKey().toUpperCase() + " " + path.getKey() + " " + r.getKey();
                            if (!recorded.contains(name)) {
                                missing.add(name);
                            }
                        })));
        assertThat(missing).as("documented statuses with no passing ContractSchemas.assertResponse").isEmpty();
    }

    @Test
    void theAllowlistHoldsOnlyOperationsThatExist() {
        JsonNode paths = ContractSchemas.paths();
        ALLOWLIST.keySet().forEach(k -> {
            String[] p = k.split(" ");
            assertThat(paths.path(p[1]).path(p[0].toLowerCase()).isMissingNode()).as(k).isFalse();
        });
        assertThat(ALLOWLIST.keySet())
                .as("the allowlist is pinned: add or remove entries here on purpose")
                .containsExactlyInAnyOrder("GET /foods", "GET /foods/barcode/{code}");
    }

    @Test
    void noAllowlistedOperationHasASchemaCheckedTest() {
        requireUnfilteredRun();
        Set<String> recorded = ContractSchemas.recorded();
        Set<String> stale = new TreeSet<>();
        ALLOWLIST.keySet().forEach(k -> {
            if (recorded.stream().anyMatch(c -> c.startsWith(k + " "))) {
                stale.add(k);
            }
        });
        assertThat(stale).as("allowlisted operations that now have a schema-checked test: remove them from ALLOWLIST").isEmpty();
    }
}
