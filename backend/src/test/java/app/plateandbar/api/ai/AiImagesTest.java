package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** The image rules of ADR 008 against the shared vectors ({@code packages/api/test-vectors/ai-images.json}). */
class AiImagesTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode VECTORS = read();
    private static final byte[] PNG_8X8 = Base64.getDecoder().decode(VECTORS.path("cases").get(0).path("data").asString());

    private static JsonNode read() {
        try {
            return JSON.readTree(Files.readAllBytes(Path.of("..", "packages", "api", "test-vectors", "ai-images.json")));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- building the vectors that have a "build" instead of "data" ----

    private static byte[] chunk(String type, byte[] data) {
        ByteBuffer b = ByteBuffer.allocate(12 + data.length);
        b.putInt(data.length).put(type.getBytes(StandardCharsets.US_ASCII)).put(data);
        CRC32 crc = new CRC32();
        crc.update(b.array(), 4, 4 + data.length);
        b.putInt((int) crc.getValue());
        return b.array();
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) {
            out.writeBytes(p);
        }
        return out.toByteArray();
    }

    private static byte[] zlibZeros(int n) {
        Deflater d = new Deflater(9);
        d.setInput(new byte[n]);
        d.finish();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        while (!d.finished()) {
            out.write(buf, 0, d.deflate(buf));
        }
        d.end();
        return out.toByteArray();
    }

    private static byte[] withTextChunk(String type, int inflated) {
        byte[] z = zlibZeros(inflated);
        byte[] data = switch (type) {
            case "iTXt" -> concat("k\0".getBytes(StandardCharsets.US_ASCII), new byte[] {1, 0, 0, 0}, z); // flag 1, method 0, "" and ""
            default -> concat("k\0".getBytes(StandardCharsets.US_ASCII), new byte[] {0}, z); // method 0
        };
        byte[] head = Arrays.copyOfRange(PNG_8X8, 0, 33); // signature and IHDR
        return concat(head, chunk(type, data), Arrays.copyOfRange(PNG_8X8, 33, PNG_8X8.length));
    }

    private static byte[] bytesOf(JsonNode c) {
        JsonNode build = c.path("build");
        if (build.has("pad_to_bytes")) {
            return Arrays.copyOf(PNG_8X8, build.path("pad_to_bytes").asInt());
        }
        if (build.has("png_dims")) {
            ByteBuffer ihdr = ByteBuffer.allocate(13).putInt(build.path("png_dims").get(0).asInt())
                    .putInt(build.path("png_dims").get(1).asInt()).put(new byte[] {8, 2, 0, 0, 0});
            return concat(Arrays.copyOfRange(PNG_8X8, 0, 8), chunk("IHDR", ihdr.array()));
        }
        if (build.has("png_text_chunk")) {
            return withTextChunk(build.path("png_text_chunk").path("type").asString(),
                    build.path("png_text_chunk").path("inflated_bytes").asInt());
        }
        return Base64.getDecoder().decode(c.path("data").asString());
    }

    private static String dataOf(JsonNode c) {
        return c.has("data") ? c.path("data").asString() : Base64.getEncoder().encodeToString(bytesOf(c));
    }

    private static ObjectNode slot(String mediaType, String data) {
        return JSON.createObjectNode().put("media_type", mediaType).put("data", data);
    }

    /** What the service does: screen, then re-encode the original slot. Returns the new JPEG. */
    private static byte[] run(AiImages.Kind kind, ObjectNode slot) {
        if (kind == AiImages.Kind.PHOTO) {
            AiImages.screenImage(JSON.createObjectNode().set("image", slot));
            return AiImages.reencode(slot, "image", kind);
        }
        AiImages.screenFrames(JSON.createObjectNode().set("frames", JSON.createArrayNode().add(slot)));
        return AiImages.reencode(slot, "frames[0]", kind);
    }

    private static ErrorResponse.Detail detailOf(Throwable t) {
        assertThat(t).isInstanceOf(ApiException.class);
        ApiException e = (ApiException) t;
        assertThat(e.status().value()).isEqualTo(400);
        assertThat(e.code()).isEqualTo("invalid_request");
        assertThat(e.details()).hasSize(1);
        return e.details().get(0);
    }

    // ---- the vectors ----

    @Test
    void everyVectorGivesItsExpectedOutcome() {
        assertThat(VECTORS.path("cases").size()).isGreaterThanOrEqualTo(25);
        for (JsonNode c : VECTORS.path("cases")) {
            AiImages.Kind kind = c.path("kind").asString().equals("frame") ? AiImages.Kind.FRAME : AiImages.Kind.PHOTO;
            ObjectNode slot = slot(c.path("media_type").asString(), dataOf(c));
            if (c.path("issue").isNull()) {
                byte[] jpeg = run(kind, slot);
                assertThat(jpeg).as(c.path("name").asString()).isNotEmpty();
                assertThat(jpeg[0] & 0xFF).isEqualTo(0xFF); // a new JPEG
                assertThat(jpeg[1] & 0xFF).isEqualTo(0xD8);
            } else {
                String field = (kind == AiImages.Kind.PHOTO ? "image." : "frames[0].")
                        + (c.path("issue").asString().equals("unsupported_type") ? "media_type" : "data");
                assertThatThrownBy(() -> run(kind, slot)).as(c.path("name").asString())
                        .satisfies(t -> assertThat(detailOf(t)).isEqualTo(new ErrorResponse.Detail(field, c.path("issue").asString())));
            }
        }
    }

    @Test
    void theFirstFaultInTheContractsOrderWins() {
        assertThat(VECTORS.path("order")).extracting(JsonNode::asString).containsExactly(
                "unsupported_type", "invalid_base64", "too_large", "type_mismatch", "dimensions", "unreadable_image");
        String png = Base64.getEncoder().encodeToString(PNG_8X8);
        // unsupported type beats a bad base64
        assertThatThrownBy(() -> run(AiImages.Kind.PHOTO, slot("image/gif", "!")))
                .satisfies(t -> assertThat(detailOf(t).issue()).isEqualTo("unsupported_type"));
        // bad base64 beats too large (a huge text with one stray character)
        String huge = "A".repeat(1_700_000 - 1) + "!";
        assertThatThrownBy(() -> run(AiImages.Kind.PHOTO, slot("image/png", huge)))
                .satisfies(t -> assertThat(detailOf(t).issue()).isEqualTo("invalid_base64"));
        // too large beats a type mismatch
        String big = Base64.getEncoder().encodeToString(new byte[1_200_001]);
        assertThatThrownBy(() -> run(AiImages.Kind.PHOTO, slot("image/jpeg", big)))
                .satisfies(t -> assertThat(detailOf(t).issue()).isEqualTo("too_large"));
        // a mismatch beats the dimensions of a PNG labelled JPEG
        assertThatThrownBy(() -> run(AiImages.Kind.PHOTO, slot("image/jpeg", png)))
                .satisfies(t -> assertThat(detailOf(t).issue()).isEqualTo("type_mismatch"));
    }

    @Test
    void theBase64ScanIsTheContractsPatternWithoutARegex() {
        assertThat(AiImages.base64Padding("AAAA")).isZero();
        assertThat(AiImages.base64Padding("AAA=")).isEqualTo(1);
        assertThat(AiImages.base64Padding("AA==")).isEqualTo(2);
        for (String bad : new String[] {"", "AAA", "AAAAA", "====", "A===", "AA=A", "A=AA", "AAA?", "AA\nA", "AAAA ", "ÀAAA"}) {
            assertThat(AiImages.base64Padding(bad)).as("[%s]", bad).isEqualTo(-1);
        }
        assertThat(AiImages.base64Padding("A".repeat(1_600_000))).isZero();
        assertThat(AiImages.base64Padding("A".repeat(1_599_996) + "A!A=")).isEqualTo(-1);
    }

    @Test
    void screeningSwapsTheCheckedDataForAStandInAndLeavesTheRequestAlone() {
        ObjectNode body = JSON.createObjectNode();
        body.set("image", slot("image/png", Base64.getEncoder().encodeToString(PNG_8X8)));
        JsonNode screened = AiImages.screenImage(body);
        assertThat(screened.path("image").path("data").asString()).isEqualTo("AAAA");
        assertThat(body.path("image").path("data").asString()).hasSizeGreaterThan(20);
        // a body the schema must judge (no image, or an image that is not an object) is passed through untouched
        ObjectNode other = JSON.createObjectNode().put("text", "x");
        assertThat(AiImages.screenImage(other)).isSameAs(other);
        ObjectNode notObject = JSON.createObjectNode().put("image", "x");
        assertThat(AiImages.screenImage(notObject)).isSameAs(notObject);
    }

    @Test
    void aFrameIsNamedByItsIndex() {
        ObjectNode ok = slot("image/png", Base64.getEncoder().encodeToString(PNG_8X8));
        ObjectNode bad = slot("image/png", "nope!");
        ObjectNode body = JSON.createObjectNode();
        body.set("frames", JSON.createArrayNode().add(ok).add(bad));
        assertThatThrownBy(() -> AiImages.screenFrames(body))
                .satisfies(t -> assertThat(detailOf(t)).isEqualTo(new ErrorResponse.Detail("frames[1].data", "invalid_base64")));
    }

    // ---- EXIF, orientation, size ----

    private static byte[] ofVector(String name) {
        for (JsonNode c : VECTORS.path("cases")) {
            if (c.path("name").asString().startsWith(name)) {
                return bytesOf(c);
            }
        }
        throw new IllegalStateException(name);
    }

    private static boolean hasApp1(byte[] jpeg) {
        for (int p = 2; p + 4 <= jpeg.length && (jpeg[p] & 0xFF) == 0xFF; ) {
            int m = jpeg[p + 1] & 0xFF;
            if (m == 0xE1) {
                return true;
            }
            if (m == 0xDA) {
                return false;
            }
            p += 2 + ((jpeg[p + 2] & 0xFF) << 8 | (jpeg[p + 3] & 0xFF));
        }
        return false;
    }

    private static boolean contains(byte[] hay, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= hay.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return true;
        }
        return false;
    }

    @Test
    void theGpsVectorComesOutWithoutExifOrAGpsTag() {
        byte[] in = ofVector("jpeg ok, carries EXIF");
        assertThat(contains(in, "Exif".getBytes(StandardCharsets.US_ASCII))).isTrue();
        assertThat(contains(in, new byte[] {(byte) 0x88, 0x25})).as("GPS IFD pointer in the input").isTrue();
        byte[] out = run(AiImages.Kind.PHOTO, slot("image/jpeg", Base64.getEncoder().encodeToString(in)));
        assertThat(hasApp1(out)).isFalse();
        assertThat(contains(out, "Exif".getBytes(StandardCharsets.US_ASCII))).isFalse();
        assertThat(contains(out, new byte[] {(byte) 0x88, 0x25})).isFalse();
        assertThat(contains(out, "MM\0*".getBytes(StandardCharsets.ISO_8859_1))).isFalse();
    }

    private static BufferedImage decoded(byte[] jpeg) throws IOException {
        return ImageIO.read(new ByteArrayInputStream(jpeg));
    }

    private static byte[] exifSegment(boolean littleEndian, int orientation) {
        ByteBuffer tiff = ByteBuffer.allocate(26).order(littleEndian ? java.nio.ByteOrder.LITTLE_ENDIAN : java.nio.ByteOrder.BIG_ENDIAN)
                .put(new byte[] {(byte) (littleEndian ? 'I' : 'M'), (byte) (littleEndian ? 'I' : 'M')})
                .putShort((short) 42).putInt(8).putShort((short) 1)
                .putShort((short) 0x0112).putShort((short) 3).putInt(1).putShort((short) orientation).putShort((short) 0).putInt(0);
        byte[] exif = concat("Exif\0\0".getBytes(StandardCharsets.US_ASCII), tiff.array());
        return ByteBuffer.allocate(4 + exif.length).put(new byte[] {(byte) 0xFF, (byte) 0xE1}).putShort((short) (exif.length + 2)).put(exif).array();
    }

    /** A 40x20 JPEG, a red 10x10 block at the top left, with the given APP1 segments after SOI. */
    private static byte[] jpegWith(int w, int h, byte[]... segments) throws IOException {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = img.createGraphics();
        g.setColor(java.awt.Color.RED);
        g.fillRect(0, 0, 10, 10);
        g.dispose();
        ByteArrayOutputStream plain = new ByteArrayOutputStream();
        ImageIO.write(img, "jpeg", plain);
        byte[] j = plain.toByteArray();
        return concat(Arrays.copyOfRange(j, 0, 2), concat(segments), Arrays.copyOfRange(j, 2, j.length));
    }

    private static BufferedImage photo(byte[] jpeg) throws IOException {
        return decoded(run(AiImages.Kind.PHOTO, slot("image/jpeg", Base64.getEncoder().encodeToString(jpeg))));
    }

    private static boolean red(BufferedImage img, int x, int y) {
        int rgb = img.getRGB(x, y);
        return (rgb >> 16 & 0xFF) > 180 && (rgb >> 8 & 0xFF) < 90 && (rgb & 0xFF) < 90;
    }

    /** Which corner (0 top left, 1 top right, 2 bottom right, 3 bottom left) is red, sampled a little inside. */
    private static int redCorner(BufferedImage img) {
        int r = img.getWidth() - 3;
        int b = img.getHeight() - 3;
        boolean[] c = {red(img, 3, 3), red(img, r, 3), red(img, r, b), red(img, 3, b)};
        int found = -1;
        for (int i = 0; i < 4; i++) {
            if (c[i]) {
                assertThat(found).as("only one red corner").isEqualTo(-1);
                found = i;
            }
        }
        return found;
    }

    @Test
    void theExifOrientationIsAppliedAndThenDropped() throws IOException {
        // where the red top-left corner of the stored image ends up once the photo is upright
        int[] corner = {0, 0, 1, 2, 3, 0, 1, 2, 3};
        for (boolean le : new boolean[] {false, true}) {
            for (int o = 1; o <= 8; o++) {
                byte[] out = run(AiImages.Kind.PHOTO, slot("image/jpeg", Base64.getEncoder().encodeToString(jpegWith(40, 20, exifSegment(le, o)))));
                BufferedImage img = decoded(out);
                String what = "orientation " + o + (le ? " II" : " MM");
                assertThat(img.getWidth()).as(what).isEqualTo(o >= 5 ? 20 : 40);
                assertThat(img.getHeight()).as(what).isEqualTo(o >= 5 ? 40 : 20);
                assertThat(redCorner(img)).as(what).isEqualTo(corner[o]);
                assertThat(hasApp1(out)).isFalse();
            }
        }
    }

    @Test
    void theFirstExifSegmentDecides() throws IOException {
        BufferedImage img = photo(jpegWith(40, 20, exifSegment(false, 1), exifSegment(false, 6)));
        assertThat(img.getWidth()).isEqualTo(40);
    }

    @Test
    void aBigPhotoIsShrunkToTheLongSideLimit() throws IOException {
        BufferedImage big = new BufferedImage(3000, 1000, BufferedImage.TYPE_INT_ARGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(big, "png", png);
        BufferedImage out = decoded(run(AiImages.Kind.PHOTO, slot("image/png", Base64.getEncoder().encodeToString(png.toByteArray()))));
        assertThat(out.getWidth()).isEqualTo(1600);
        assertThat(out.getHeight()).isEqualTo(533);
        // a transparent PNG is flattened on white
        int rgb = out.getRGB(800, 266);
        assertThat(rgb >> 16 & 0xFF).isGreaterThan(240);
        assertThat(rgb >> 8 & 0xFF).isGreaterThan(240);
        assertThat(rgb & 0xFF).isGreaterThan(240);
    }

    @Test
    void theLimitsAreTheContractsAndTheSideLimitPasses() throws IOException {
        assertThat(AiImages.Kind.PHOTO.maxBytes).isEqualTo(VECTORS.path("max_decoded_bytes").path("photo").asInt());
        assertThat(AiImages.Kind.FRAME.maxBytes).isEqualTo(VECTORS.path("max_decoded_bytes").path("frame").asInt());
        assertThat(AiImages.Kind.PHOTO.maxSide).isEqualTo(VECTORS.path("max_side_px").path("photo").asInt());
        assertThat(AiImages.Kind.FRAME.maxSide).isEqualTo(VECTORS.path("max_side_px").path("frame").asInt());
        assertThat(AiImages.MAX_PIXELS).isEqualTo(VECTORS.path("max_megapixels").asLong() * 1_000_000L);
        assertThat(AiImages.MAX_METADATA_INFLATED).isEqualTo(VECTORS.path("max_metadata_inflated_bytes").asInt());
        assertThat(AiImages.MAX_LONG_SIDE).isEqualTo(VECTORS.path("reencode").path("max_long_side_px").asInt());
        for (AiImages.Kind kind : AiImages.Kind.values()) {
            int side = kind.maxSide;
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            ImageIO.write(new BufferedImage(side, 1, BufferedImage.TYPE_INT_RGB), "png", png);
            assertThat(run(kind, slot("image/png", Base64.getEncoder().encodeToString(png.toByteArray())))).isNotEmpty();
        }
    }

    // ---- memory and disk ----

    private static long allocated() {
        return ((com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean())
                .getThreadAllocatedBytes(Thread.currentThread().threadId());
    }

    @Test
    void decompressionBombsAreRefusedWithoutAllocatingMuch() {
        run(AiImages.Kind.PHOTO, slot("image/png", Base64.getEncoder().encodeToString(PNG_8X8))); // warm up the classes
        for (JsonNode c : VECTORS.path("cases")) {
            String name = c.path("name").asString();
            boolean bomb = name.contains("50 MB") || name.contains("65,537") || name.contains("is over 16 megapixels")
                    || name.contains("4097 px wide");
            if (!bomb) {
                continue;
            }
            ObjectNode slot = slot(c.path("media_type").asString(), dataOf(c));
            long before = allocated();
            assertThatThrownBy(() -> run(AiImages.Kind.PHOTO, slot)).as(name).isInstanceOf(ApiException.class);
            // a 50 MB or 64 MB buffer would show here; the bounded inflate and the header check use a few KB
            assertThat(allocated() - before).as(name).isLessThan(2_000_000L);
        }
    }

    @Test
    void aCompressedChunkAtTheLimitPassesAndOneByteOverFails() {
        for (String type : new String[] {"zTXt", "iTXt", "iCCP"}) {
            assertThat(run(AiImages.Kind.PHOTO, slot("image/png", Base64.getEncoder().encodeToString(withTextChunk(type, 65_536))))).isNotEmpty();
            assertThatThrownBy(() -> run(AiImages.Kind.PHOTO, slot("image/png", Base64.getEncoder().encodeToString(withTextChunk(type, 65_537)))))
                    .satisfies(t -> assertThat(detailOf(t).issue()).isEqualTo("unreadable_image"));
        }
    }

    @Test
    void nothingIsWrittenToDisk(@TempDir Path dir) throws IOException {
        java.io.File old = ImageIO.getCacheDirectory();
        ImageIO.setCacheDirectory(dir.toFile());
        try {
            assertThat(ImageIO.getUseCache()).isFalse();
            for (JsonNode c : VECTORS.path("cases")) {
                if (c.path("issue").isNull() && !c.path("name").asString().contains("limit")) {
                    run(c.path("kind").asString().equals("frame") ? AiImages.Kind.FRAME : AiImages.Kind.PHOTO,
                            slot(c.path("media_type").asString(), dataOf(c)));
                }
            }
            try (var files = Files.list(dir)) {
                assertThat(files.toList()).isEmpty();
            }
        } finally {
            ImageIO.setCacheDirectory(old);
        }
    }
}
