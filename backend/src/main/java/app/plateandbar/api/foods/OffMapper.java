package app.plateandbar.api.foods;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * Turns an Open Food Facts product into the contract's {@code OffProduct}, keeping only the listed fields. The server maps
 * nothing else: turning it into a {@code UserFood} is a rule in {@code packages/core}. Everything from upstream is untrusted:
 * strings are stripped of control characters, trimmed and capped; a nutriment, {@code serving_quantity} or
 * {@code completeness} that is negative, not finite or not numeric is dropped (never clamped or zeroed); {@code code} is
 * always the one the caller asked for.
 */
final class OffMapper {
    private OffMapper() {}

    /** Open Food Facts' own keys; {@code sugars} (total) and bare {@code energy} (kJ) are deliberately absent. */
    static final List<String> NUTRIMENTS = List.of(
            "energy-kcal_100g", "energy-kj_100g", "proteins_100g", "carbohydrates_100g", "fat_100g", "fiber_100g",
            "added-sugars_100g", "energy-kcal_serving", "energy-kj_serving", "proteins_serving",
            "carbohydrates_serving", "fat_serving", "fiber_serving", "added-sugars_serving");

    /** The upstream fields we ask for; the same names this mapper reads. */
    static final String FIELDS = "code,product_name,brands,quantity,serving_size,serving_quantity,nutrition_data_per,"
            + "nutriments,completeness,states_tags,data_quality_errors_tags,countries_tags,last_modified_t";

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Pattern NUMERIC = Pattern.compile("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?");
    private static final long MAX_EPOCH_SECONDS = 253_402_300_799L; // 9999-12-31T23:59:59Z

    /** Empty when there is no usable product: none given, or no nutriment survived (the contract's 404 {@code not_found}). */
    static Optional<ObjectNode> map(String code, JsonNode product) {
        if (product == null || !product.isObject()) {
            return Optional.empty();
        }
        JsonNode nutrimentsIn = product.path("nutriments");
        ObjectNode nutriments = F.objectNode();
        if (nutrimentsIn.isObject()) {
            for (String key : NUTRIMENTS) {
                Double v = number(nutrimentsIn.get(key));
                if (v != null && v >= 0) {
                    nutriments.set(key, numberNode(v));
                }
            }
        }
        if (nutriments.isEmpty()) {
            return Optional.empty();
        }
        ObjectNode out = F.objectNode();
        out.put("code", code);
        putText(out, "name", product.get("product_name"), 200);
        putText(out, "brands", product.get("brands"), 200);
        putText(out, "quantity", product.get("quantity"), 100);
        putText(out, "serving_size", product.get("serving_size"), 100);
        Double serving = number(product.get("serving_quantity"));
        out.set("serving_quantity", serving != null && serving > 0 ? numberNode(serving) : F.nullNode());
        String per = text(product.get("nutrition_data_per"), 20);
        out.put("nutrition_data_per", "100g".equals(per) || "serving".equals(per) ? per : null);
        out.set("nutriments", nutriments);
        Double completeness = number(product.get("completeness"));
        out.set("completeness", completeness != null && completeness >= 0 && completeness <= 1 ? numberNode(completeness) : F.nullNode());
        out.set("states_tags", tags(product.get("states_tags")));
        out.set("data_quality_errors_tags", tags(product.get("data_quality_errors_tags")));
        out.set("countries_tags", tags(product.get("countries_tags")));
        Double modified = number(product.get("last_modified_t"));
        out.put("last_modified_at", modified != null && modified >= 0 && modified <= MAX_EPOCH_SECONDS
                ? Instant.ofEpochSecond(modified.longValue()).toString() : null);
        ObjectNode source = F.objectNode();
        source.put("code", "open_food_facts");
        source.put("name", "Open Food Facts");
        source.put("licence", "ODbL 1.0 / DbCL 1.0");
        source.put("url", "https://world.openfoodfacts.org/product/" + code);
        source.put("reference", code);
        out.set("source", source);
        return Optional.of(out);
    }

    /** A JSON number, or a plain decimal string such as "12.5"; null for anything else or a value that is not finite. */
    static Double number(JsonNode n) {
        if (n == null) {
            return null;
        }
        double d;
        if (n.isNumber()) {
            d = n.doubleValue();
        } else if (n.isString()) {
            String s = n.asString().trim();
            // Double.parseDouble alone would also take "NaN", "Infinity", "0x1p3" and "12d".
            if (s.length() > 40 || !NUMERIC.matcher(s).matches()) {
                return null;
            }
            d = Double.parseDouble(s);
        } else {
            return null;
        }
        return Double.isFinite(d) ? d : null;
    }

    private static JsonNode numberNode(double v) {
        return v == Math.rint(v) && Math.abs(v) < 1e15 ? F.numberNode((long) v) : F.numberNode(v);
    }

    /** Control characters and unpaired surrogates removed, trimmed, cut to {@code max} characters; null when nothing is left. */
    static String text(JsonNode n, int max) {
        if (n == null || !n.isString()) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        n.asString().codePoints().forEach(cp -> {
            int type = Character.getType(cp);
            if (type != Character.CONTROL && type != Character.LINE_SEPARATOR && type != Character.PARAGRAPH_SEPARATOR
                    && type != Character.SURROGATE && type != Character.UNASSIGNED) {
                sb.appendCodePoint(cp);
            }
        });
        String s = sb.toString().strip();
        if (s.codePointCount(0, s.length()) > max) {
            s = s.substring(0, s.offsetByCodePoints(0, max)).strip();
        }
        return s.isEmpty() ? null : s;
    }

    private static void putText(ObjectNode out, String key, JsonNode in, int max) {
        out.put(key, text(in, max));
    }

    /** At most 50 tags; a tag over 100 characters is dropped rather than cut into a different tag. */
    private static JsonNode tags(JsonNode in) {
        List<String> kept = new ArrayList<>();
        if (in != null && in.isArray()) {
            for (JsonNode t : in) {
                String s = text(t, 101);
                if (s != null && s.codePointCount(0, s.length()) <= 100 && kept.size() < 50) {
                    kept.add(s);
                }
            }
        }
        var arr = F.arrayNode();
        kept.forEach(arr::add);
        return arr;
    }
}
