package app.plateandbar.api.sync;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.ObjectMapper;

/**
 * Measures values of a {@code POST /sync} body the way {@code x-max-json-bytes} defines it: UTF-8 bytes of the value
 * as compact JSON, written like {@code JSON.stringify} writes it (no whitespace; strings escaped as it escapes
 * them), but a number keeps the text the client sent, so {@code 1e2} counts 3 bytes, not the 3 of {@code 100} or
 * the 5 of a re-serialised {@code 100.0}. It reads the raw bytes with a streaming parser, because a parsed
 * {@code JsonNode} no longer has the number text.
 *
 * <p>Only values at {@code changes.<table>[i].<field>} (or {@code ...<field>[j]} for an item limit) are measured.
 * Nothing here logs or returns body content; a violation is a path built from the contract's names and indexes.
 */
final class CompactJsonSizes {

    /** Limit for one field of a table: the whole value, or each item of the array the field holds. */
    record Limit(long bytes, boolean perItem) {}

    private CompactJsonSizes() {}

    /**
     * Paths (as the contract writes them, {@code changes.settings[0].learn}) of the measured values over their limit,
     * in document order. {@code limits} is by table name, then field name. The parser comes from {@code mapper}, the
     * one that parsed the request, so its limits (nesting depth) are the same and cannot drift. A body that does not
     * parse throws: the caller refuses the request, so an oversized value can never pass by making this fail.
     */
    static List<String> overLimit(ObjectMapper mapper, byte[] raw, Map<String, Map<String, Limit>> limits) {
        List<String> over = new ArrayList<>();
        if (limits.isEmpty()) {
            return over;
        }
        try (JsonParser p = mapper.createParser(raw)) {
            walk(p, limits, over);
        }
        return over;
    }

    private static final class Frame {
        final boolean object;
        long size = 1; // the opening bracket
        int children;
        String key; // the key of the child being read (object) or its index (array)

        Frame(boolean object) {
            this.object = object;
        }
    }

    private static void walk(JsonParser p, Map<String, Map<String, Limit>> limits, List<String> over) {
        Deque<Frame> stack = new ArrayDeque<>();
        List<String> path = new ArrayList<>(); // segments of the value being read: key names, array indexes
        JsonToken t;
        while ((t = p.nextToken()) != null) {
            switch (t) {
                case PROPERTY_NAME -> {
                    Frame top = stack.peek();
                    top.key = p.currentName();
                    path.set(path.size() - 1, top.key);
                }
                case START_OBJECT, START_ARRAY -> {
                    enter(stack, path);
                    stack.push(new Frame(t == JsonToken.START_OBJECT));
                    path.add(null);
                }
                case END_OBJECT, END_ARRAY -> {
                    Frame done = stack.pop();
                    path.remove(path.size() - 1);
                    done.size += 1; // the closing bracket
                    finish(stack, path, done.size, limits, over);
                }
                default -> {
                    enter(stack, path);
                    finish(stack, path, scalarSize(p, t), limits, over);
                }
            }
            if (stack.isEmpty()) {
                return; // the root value is complete; what follows is the request parser's business, not measured
            }
        }
    }

    /** Called when a value starts: an array element names its slot (its index) in the path. */
    private static void enter(Deque<Frame> stack, List<String> path) {
        Frame parent = stack.peek();
        if (parent != null && !parent.object) {
            parent.key = Integer.toString(parent.children);
            path.set(path.size() - 1, parent.key);
        }
    }

    /** A value is complete: check it, then add it (with its comma and key) to the parent's size. */
    private static void finish(
            Deque<Frame> stack, List<String> path, long size, Map<String, Map<String, Limit>> limits,
            List<String> over) {
        Frame parent = stack.peek();
        if (parent == null) {
            return;
        }
        String found = violation(path, size, limits);
        if (found != null) {
            over.add(found);
        }
        long add = size;
        if (parent.children > 0) {
            add += 1; // the comma
        }
        if (parent.object) {
            add += quotedSize(parent.key) + 1; // "key":
        }
        parent.size += add;
        parent.children++;
    }

    /** The path of a value over its limit, or null. {@code segments} is [changes, table, i, field] or [.., j]. */
    private static String violation(List<String> segments, long size, Map<String, Map<String, Limit>> limits) {
        int n = segments.size();
        if ((n != 4 && n != 5) || !"changes".equals(segments.get(0))) {
            return null;
        }
        Map<String, Limit> table = limits.get(segments.get(1));
        Limit limit = table == null ? null : table.get(segments.get(3));
        if (limit == null || limit.perItem() != (n == 5) || size <= limit.bytes()) {
            return null;
        }
        String path = "changes." + segments.get(1) + "[" + segments.get(2) + "]." + segments.get(3);
        return n == 5 ? path + "[" + segments.get(4) + "]" : path;
    }

    private static long scalarSize(JsonParser p, JsonToken t) {
        return switch (t) {
            case VALUE_STRING -> quotedSize(p.getString());
            case VALUE_NUMBER_INT, VALUE_NUMBER_FLOAT -> p.getString().getBytes(StandardCharsets.UTF_8).length; // as sent
            case VALUE_TRUE, VALUE_NULL -> 4;
            case VALUE_FALSE -> 5;
            default -> throw new IllegalStateException("unexpected token");
        };
    }

    /** Bytes of {@code s} as JSON.stringify writes a string: quotes, escapes for ", \, control characters and lone surrogates. */
    static long quotedSize(String s) {
        long n = 2;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t') {
                n += 2;
            } else if (c < 0x20) {
                n += 6; // six bytes: backslash, u, four hex digits
            } else if (Character.isHighSurrogate(c) && i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))) {
                n += 4; // a pair is one 4-byte UTF-8 character
                i++;
            } else if (Character.isSurrogate(c)) {
                n += 6; // a lone surrogate is written as six bytes of escape
            } else if (c < 0x80) {
                n += 1;
            } else if (c < 0x800) {
                n += 2;
            } else {
                n += 3;
            }
        }
        return n;
    }
}
