package app.plateandbar.api.sync;

import java.util.OptionalLong;
import java.util.regex.Pattern;

/** The opaque sync cursor: {@code c_} plus the user's change number as 16 hex digits. */
final class Cursor {
    private static final Pattern FORMAT = Pattern.compile("c_[0-9a-f]{16}");

    private Cursor() {}

    static String format(long seq) {
        return String.format("c_%016x", seq);
    }

    /** The change number, or empty when {@code cursor} is not one this server could have issued. */
    static OptionalLong parse(String cursor) {
        if (!FORMAT.matcher(cursor).matches()) {
            return OptionalLong.empty();
        }
        long seq = Long.parseUnsignedLong(cursor.substring(2), 16);
        return seq < 0 ? OptionalLong.empty() : OptionalLong.of(seq);
    }
}
