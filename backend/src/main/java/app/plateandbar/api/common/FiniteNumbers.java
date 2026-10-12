package app.plateandbar.api.common;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A JSON number too large for a double (1e400, or an integer of 400 digits) passes a schema with no {@code maximum}
 * and cannot be compared or stored (#420). Bodies holding one are treated as unparseable.
 */
public final class FiniteNumbers {
    private FiniteNumbers() {}

    /** True when every number in {@code node} is finite. Recursion depth is bounded by Jackson's nesting limit. */
    public static boolean all(JsonNode node) {
        if (node == null) {
            return true;
        }
        if (node.isNumber()) {
            return Double.isFinite(node.doubleValue()); // also a 400-digit integer, which no double or JSON column holds
        }
        for (JsonNode child : node) {
            if (!all(child)) {
                return false;
            }
        }
        return true;
    }
}
