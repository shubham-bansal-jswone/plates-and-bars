package app.plateandbar.api.sync;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;
import java.util.regex.Pattern;

/** Name-based UUIDs (RFC 4122 version 5, SHA-1) for the contract's natural-key record ids. */
final class Uuids {
    private static final Pattern CANONICAL =
            Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private Uuids() {}

    static boolean isCanonical(String s) {
        return s != null && CANONICAL.matcher(s).matches();
    }

    static UUID v5(UUID namespace, String name) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            sha1.update(ByteBuffer.allocate(16)
                    .putLong(namespace.getMostSignificantBits())
                    .putLong(namespace.getLeastSignificantBits())
                    .array());
            byte[] h = sha1.digest(name.getBytes(StandardCharsets.UTF_8));
            h[6] = (byte) ((h[6] & 0x0f) | 0x50);
            h[8] = (byte) ((h[8] & 0x3f) | 0x80);
            ByteBuffer b = ByteBuffer.wrap(h);
            return new UUID(b.getLong(), b.getLong());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
