package app.plateandbar.api.common;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A JSON number too large for a double (such as 1e400) parses to Infinity, which passes a schema's {@code maximum}
 * and cannot be compared or stored (#420). Bodies holding one are treated as unparseable.
 */
public final class FiniteNumbers {
    private FiniteNumbers() {}

    /** True when every number in {@code node} is finite. Recursion depth is bounded by Jackson's nesting limit. */
    public static boolean all(JsonNode node) {
        if (node == null) {
            return true;
        }
        if (node.isFloatingPointNumber()) {
            return Double.isFinite(node.doubleValue());
        }
        for (JsonNode child : node) {
            if (!all(child)) {
                return false;
            }
        }
        return true;
    }
}
