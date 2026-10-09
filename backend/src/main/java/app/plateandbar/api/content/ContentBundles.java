package app.plateandbar.api.content;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

/**
 * Every {@code content/*.json} in the build (copied into the jar under {@code /content} by Gradle), served byte for byte.
 * The SHA-256, size and schema version are computed once at startup from the exact bytes; {@code updated_at} comes from
 * the {@code CONTENT_UPDATED_AT} build argument ({@code name=timestamp,...}, see backend/README.md). A bundle without a
 * value, an unreadable or empty file, or a file without an integer {@code schema_version} stops the app from starting:
 * there is no fallback to build time or any other default.
 */
@Component
public class ContentBundles {

    public static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9-]{0,63}$");
    private static final DateTimeFormatter UTC_SECONDS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");

    /** One manifest entry (field names are the contract's). */
    public record Info(
            @JsonProperty("name") String name,
            @JsonProperty("schema_version") int schemaVersion,
            @JsonProperty("sha256") String sha256,
            @JsonProperty("size_bytes") int sizeBytes,
            @JsonProperty("updated_at") String updatedAt) {}

    /** A served body with its strong ETag. */
    public record Served(byte[] body, String etag) {}

    private final Map<String, Served> bundles = new HashMap<>();
    private final Served manifest;

    @Autowired
    public ContentBundles(ObjectMapper json, @Value("${app.content.updated-at:}") String updatedAt) {
        this(json, classpathFiles(), updatedAt);
    }

    ContentBundles(ObjectMapper json, Map<String, byte[]> files, String updatedAt) {
        Map<String, String> stamps = parseUpdatedAt(updatedAt);
        List<Info> infos = new ArrayList<>();
        for (Map.Entry<String, byte[]> file : new TreeMap<>(files).entrySet()) {
            String name = file.getKey();
            byte[] bytes = file.getValue();
            if (!NAME.matcher(name).matches() || name.equals("manifest")) {
                throw new IllegalStateException("content file name '" + name + "' cannot be a bundle name");
            }
            if (bytes.length == 0) {
                throw new IllegalStateException("content/" + name + ".json is empty");
            }
            String stamp = stamps.get(name);
            if (stamp == null) {
                throw new IllegalStateException(
                        "CONTENT_UPDATED_AT has no value for content/" + name + ".json (see backend/README.md)");
            }
            String sha = sha256(bytes);
            infos.add(new Info(name, schemaVersion(json, name, bytes), sha, bytes.length, stamp));
            bundles.put(name, new Served(bytes, quote(sha)));
        }
        infos.sort(Comparator.comparing(Info::name));
        byte[] body;
        try {
            body = json.writeValueAsBytes(Map.of("bundles", infos));
        } catch (IOException e) {
            throw new IllegalStateException("content manifest cannot be written", e);
        }
        this.manifest = new Served(body, quote(sha256(body)));
        this.infos = List.copyOf(infos);
    }

    private final List<Info> infos;

    public Served manifest() {
        return manifest;
    }

    public List<Info> infos() {
        return infos;
    }

    /** The bundle, or null when the name is not in the manifest. */
    public Served bundle(String name) {
        return bundles.get(name);
    }

    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String quote(String sha) {
        return "\"" + sha + "\"";
    }

    private static int schemaVersion(ObjectMapper json, String name, byte[] bytes) {
        JsonNode root;
        try {
            root = json.readTree(bytes);
        } catch (IOException e) {
            throw new IllegalStateException("content/" + name + ".json is not valid JSON");
        }
        JsonNode v = root == null ? null : root.get("schema_version");
        if (v == null || !v.isInt() || v.intValue() < 1) {
            throw new IllegalStateException("content/" + name + ".json has no integer schema_version of 1 or more");
        }
        return v.intValue();
    }

    /** {@code name=timestamp,name=timestamp}; any offset is accepted and converted to UTC whole seconds. */
    static Map<String, String> parseUpdatedAt(String spec) {
        Map<String, String> out = new LinkedHashMap<>();
        if (spec == null || spec.isBlank()) {
            return out;
        }
        for (String part : spec.split(",")) {
            String p = part.trim();
            if (p.isEmpty()) {
                continue;
            }
            int eq = p.indexOf('=');
            if (eq < 1) {
                throw new IllegalStateException("CONTENT_UPDATED_AT entry is not name=timestamp");
            }
            String name = p.substring(0, eq).trim();
            try {
                String ts = OffsetDateTime.parse(p.substring(eq + 1).trim())
                        .withOffsetSameInstant(ZoneOffset.UTC)
                        .format(UTC_SECONDS);
                if (out.put(name, ts) != null) {
                    throw new IllegalStateException("CONTENT_UPDATED_AT lists '" + name + "' twice");
                }
            } catch (DateTimeParseException e) {
                throw new IllegalStateException("CONTENT_UPDATED_AT has an invalid timestamp for '" + name + "'");
            }
        }
        return out;
    }

    private static Map<String, byte[]> classpathFiles() {
        Map<String, byte[]> files = new HashMap<>();
        try {
            for (Resource r : new PathMatchingResourcePatternResolver().getResources("classpath:/content/*.json")) {
                String file = r.getFilename();
                String name = file.substring(0, file.length() - ".json".length());
                try (var in = r.getInputStream()) {
                    files.put(name, in.readAllBytes());
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("content/*.json cannot be read from the classpath", e);
        }
        if (files.isEmpty()) {
            throw new IllegalStateException("no content/*.json on the classpath (see backend/README.md)");
        }
        return files;
    }
}
