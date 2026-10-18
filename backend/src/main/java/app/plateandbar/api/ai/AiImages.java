package app.plateandbar.api.ai;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The image pipeline of Meal photo, Import recipe and Form check (ADR 008, {@code ai-images.json}). Everything is in
 * memory: nothing is written to disk, stored, cached or logged, and a fault never echoes the image.
 *
 * <p>Checks run in the contract's order for one image: {@code unsupported_type}, {@code invalid_base64},
 * {@code too_large} (arithmetic on the base64 length, before any decoding), {@code type_mismatch} (magic bytes),
 * {@code dimensions} (read from the header), {@code unreadable_image}. The first two checks are a linear scan, so the
 * schema's regex never runs on a megabyte of text ({@link #screen}). The image is then decoded on its own with
 * every metadata block skipped and written again as a new JPEG, so EXIF, GPS, XMP and thumbnails cannot leave.
 */
final class AiImages {

    /** What one image kind may be: decoded bytes and pixels on a side (the contract's AiImage and AiFrame). */
    enum Kind {
        PHOTO(1_200_000, 4096),
        FRAME(350_000, 640);

        final int maxBytes;
        final int maxSide;

        Kind(int maxBytes, int maxSide) {
            this.maxBytes = maxBytes;
            this.maxSide = maxSide;
        }
    }

    static final long MAX_PIXELS = 16_000_000L;
    /** A PNG zTXt, iTXt or iCCP chunk may inflate to at most this many bytes. */
    static final int MAX_METADATA_INFLATED = 65_536;
    static final int MAX_LONG_SIDE = 1600;
    private static final float JPEG_QUALITY = 0.85f;
    private static final Set<String> TYPES = Set.of("image/jpeg", "image/png");
    private static final byte[] PNG_SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    /** A valid stand-in for a checked {@code data}, so the schema's regex has nothing long to chew on. */
    private static final String CHECKED = "AAAA";

    /** Decodes and re-encodes running at once on this instance: 2 x (4096 x 4096 x 4 B, about 64 MB) of pixels at most (#990). */
    static final int MAX_CONCURRENT = 2;
    /** How long a request waits for a permit before it is answered 503 with Retry-After. */
    static final long PERMIT_WAIT_MS = 2_000;
    static final long RETRY_AFTER_SECONDS = 2;
    static final Semaphore PERMITS = new Semaphore(MAX_CONCURRENT, true);

    static {
        ImageIO.setUseCache(false); // the default caches an input stream in a temp file
    }

    private AiImages() {}

    /** 400 {@code invalid_request} naming the image; never the image. */
    static ApiException fault(String field, String issue) {
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "That photo couldn't be read. Try a JPEG or PNG.",
                List.of(new ErrorResponse.Detail(field, issue)));
    }

    /** The request with its {@code image} checked up to {@code too_large}, and its {@code data} swapped for a stand-in. */
    static JsonNode screenImage(JsonNode body) {
        if (!(body instanceof ObjectNode o) || !(o.get("image") instanceof ObjectNode slot)) {
            return body;
        }
        if (!checkEncoding(slot, "image", Kind.PHOTO)) {
            return body;
        }
        ObjectNode copy = o.deepCopy();
        ((ObjectNode) copy.get("image")).put("data", CHECKED);
        return copy;
    }

    /** The same for each of {@code frames}, in order. */
    static JsonNode screenFrames(JsonNode body) {
        if (!(body instanceof ObjectNode o) || !(o.get("frames") instanceof tools.jackson.databind.node.ArrayNode frames)) {
            return body;
        }
        ObjectNode copy = null;
        for (int i = 0; i < frames.size(); i++) {
            if (frames.get(i) instanceof ObjectNode slot && checkEncoding(slot, "frames[" + i + "]", Kind.FRAME)) {
                if (copy == null) {
                    copy = o.deepCopy();
                }
                ((ObjectNode) copy.get("frames").get(i)).put("data", CHECKED);
            }
        }
        return copy == null ? body : copy;
    }

    /** Checks 1 to 3. False when the slot is not shaped for them (the schema reports that); throws on a fault. */
    private static boolean checkEncoding(ObjectNode slot, String path, Kind kind) {
        JsonNode type = slot.get("media_type");
        JsonNode data = slot.get("data");
        if (type == null || data == null || !type.isString() || !data.isString()) {
            return false;
        }
        if (!TYPES.contains(type.asString())) {
            throw fault(path + ".media_type", "unsupported_type");
        }
        String s = data.asString();
        int pad = base64Padding(s);
        if (pad < 0) {
            throw fault(path + ".data", "invalid_base64");
        }
        if ((long) s.length() / 4 * 3 - pad > kind.maxBytes) {
            throw fault(path + ".data", "too_large");
        }
        return true;
    }

    /**
     * One pass over the text: standard alphabet, a multiple of 4 characters (at least 4), at most two {@code =} and only
     * at the end. Returns the number of {@code =}, or -1 when it is not base64 (the contract's pattern, without regex).
     */
    static int base64Padding(String s) {
        int n = s.length();
        if (n < 4 || n % 4 != 0) {
            return -1;
        }
        int end = n;
        while (end > n - 2 && s.charAt(end - 1) == '=') {
            end--;
        }
        for (int i = 0; i < end; i++) {
            char c = s.charAt(i);
            boolean ok = c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/';
            if (!ok) {
                return -1;
            }
        }
        return n - end;
    }

    /** Checks 4 to 6 on a slot that {@link #screenImage} or {@link #screenFrames} passed, then the new JPEG. */
    static byte[] reencode(JsonNode slot, String path, Kind kind) {
        String declared = slot.path("media_type").asString();
        byte[] raw = Base64.getDecoder().decode(slot.path("data").asString()); // size-checked: at most 1.2 MB
        boolean png = startsWith(raw, PNG_SIGNATURE);
        boolean jpeg = raw.length >= 3 && (raw[0] & 0xFF) == 0xFF && (raw[1] & 0xFF) == 0xD8 && (raw[2] & 0xFF) == 0xFF;
        if (!(declared.equals("image/png") ? png : jpeg)) {
            throw fault(path + ".data", "type_mismatch");
        }
        int[] head = png ? pngHeader(raw) : jpegHeader(raw); // width, height, orientation
        if (head == null) {
            throw fault(path + ".data", "unreadable_image");
        }
        checkDimensions(head[0], head[1], kind, path);
        try {
            if (png && !metadataWithinLimit(raw)) {
                throw fault(path + ".data", "unreadable_image");
            }
            return withPermit(PERMITS, PERMIT_WAIT_MS, () -> {
                try {
                    return encode(decode(raw, kind, path), head[2]);
                } catch (IOException e) {
                    throw new java.io.UncheckedIOException(e);
                }
            });
        } catch (RuntimeException | DataFormatException e) {
            if (e instanceof ApiException a) {
                throw a;
            }
            throw fault(path + ".data", "unreadable_image"); // the cause can hold file details: not chained, not logged
        }
    }

    /**
     * Runs {@code work} holding one permit of {@code gate}, released whatever happens. Waits at most {@code waitMs}
     * for it, then 503 {@link ImageBusyException}; an interrupted wait is the same, with the flag kept.
     */
    static <T> T withPermit(Semaphore gate, long waitMs, Supplier<T> work) {
        try {
            if (!gate.tryAcquire(waitMs, TimeUnit.MILLISECONDS)) {
                throw new ImageBusyException(RETRY_AFTER_SECONDS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ImageBusyException(RETRY_AFTER_SECONDS);
        }
        try {
            return work.get();
        } finally {
            gate.release();
        }
    }

    private static void checkDimensions(long w, long h, Kind kind, String path) {
        if (w < 1 || h < 1) {
            throw fault(path + ".data", "unreadable_image");
        }
        if (w > kind.maxSide || h > kind.maxSide || w * h > MAX_PIXELS) {
            throw fault(path + ".data", "dimensions");
        }
    }

    private static boolean startsWith(byte[] b, byte[] prefix) {
        if (b.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (b[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static long u32(byte[] b, int p) {
        return (b[p] & 0xFFL) << 24 | (b[p + 1] & 0xFFL) << 16 | (b[p + 2] & 0xFFL) << 8 | (b[p + 3] & 0xFFL);
    }

    private static int u16(byte[] b, int p) {
        return (b[p] & 0xFF) << 8 | (b[p + 1] & 0xFF);
    }

    /** Width and height from the IHDR (orientation 1), or null when there is no IHDR. A PNG has no orientation we read. */
    private static int[] pngHeader(byte[] b) {
        if (b.length < 24 || b[12] != 'I' || b[13] != 'H' || b[14] != 'D' || b[15] != 'R') {
            return null;
        }
        long w = u32(b, 16);
        long h = u32(b, 20);
        return new int[] {(int) Math.min(w, Integer.MAX_VALUE), (int) Math.min(h, Integer.MAX_VALUE), 1};
    }

    /** Width, height and the EXIF orientation (1 when absent), reading segment headers only; null when no frame header. */
    private static int[] jpegHeader(byte[] b) {
        int orientation = 1;
        boolean exifSeen = false;
        int p = 2;
        while (p + 4 <= b.length) {
            if ((b[p] & 0xFF) != 0xFF) {
                return null;
            }
            int m = b[p + 1] & 0xFF;
            if (m == 0xFF) {
                p++; // fill byte
                continue;
            }
            if (m == 0x01 || m >= 0xD0 && m <= 0xD7) {
                p += 2; // markers without a length
                continue;
            }
            if (m == 0xD9 || m == 0xDA) {
                return null; // end of image or start of scan with no frame header
            }
            int len = u16(b, p + 2);
            if (len < 2 || p + 2 + len > b.length) {
                return null;
            }
            if (m >= 0xC0 && m <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC) {
                return len < 7 ? null : new int[] {u16(b, p + 7), u16(b, p + 5), orientation};
            }
            if (m == 0xE1 && !exifSeen && len >= 8 && new String(b, p + 4, 6, StandardCharsets.ISO_8859_1).equals("Exif\0\0")) {
                exifSeen = true; // the first Exif segment decides; a later one is ignored
                orientation = exifOrientation(b, p + 4, p + 2 + len);
            }
            p += 2 + len;
        }
        return null;
    }

    /** The orientation (1 to 8) from an APP1 Exif block, or 1. Only this one tag is read; nothing else is kept. */
    private static int exifOrientation(byte[] b, int start, int end) {
        if (end - start < 14 || !new String(b, start, 6, StandardCharsets.ISO_8859_1).equals("Exif\0\0")) {
            return 1;
        }
        int t = start + 6; // TIFF header
        boolean le = b[t] == 'I';
        if (!le && b[t] != 'M') {
            return 1;
        }
        long ifd = t + (le ? u32le(b, t + 4) : u32(b, t + 4));
        if (ifd < t || ifd + 2 > end) {
            return 1;
        }
        int count = le ? u16le(b, (int) ifd) : u16(b, (int) ifd);
        for (int i = 0; i < count; i++) {
            int e = (int) ifd + 2 + i * 12;
            if (e + 12 > end) {
                return 1;
            }
            if ((le ? u16le(b, e) : u16(b, e)) == 0x0112) {
                int v = le ? u16le(b, e + 8) : u16(b, e + 8);
                return v >= 1 && v <= 8 ? v : 1;
            }
        }
        return 1;
    }

    private static int u16le(byte[] b, int p) {
        return (b[p] & 0xFF) | (b[p + 1] & 0xFF) << 8;
    }

    private static long u32le(byte[] b, int p) {
        return (b[p] & 0xFFL) | (b[p + 1] & 0xFFL) << 8 | (b[p + 2] & 0xFFL) << 16 | (b[p + 3] & 0xFFL) << 24;
    }

    /**
     * False when a zTXt, iCCP or compressed iTXt chunk inflates to more than {@link #MAX_METADATA_INFLATED} bytes. The
     * inflate stops at 65,537 bytes into a small reused buffer, so a bomb costs no memory. A damaged chunk throws.
     */
    private static boolean metadataWithinLimit(byte[] b) throws DataFormatException {
        int p = 8;
        while (p + 12 <= b.length) {
            long len = u32(b, p);
            int data = p + 8;
            if (len > b.length - data - 4) {
                return true; // cut off: the decoder refuses it
            }
            int end = data + (int) len;
            String type = new String(b, p + 4, 4, StandardCharsets.ISO_8859_1);
            int from = -1; // start of a zlib stream, or -1 when the chunk holds none
            if (type.equals("zTXt") || type.equals("iCCP")) {
                int k = afterNul(b, data, end); // the method byte, then the zlib stream
                if (k < 0 || k + 1 > end) {
                    throw new DataFormatException("damaged chunk");
                }
                from = k + 1;
            } else if (type.equals("iTXt")) {
                int k = afterNul(b, data, end); // the flag byte, the method byte, language, translated keyword, text
                if (k < 0 || k + 2 > end) {
                    throw new DataFormatException("damaged chunk");
                }
                if (b[k] == 1) {
                    int lang = afterNul(b, k + 2, end);
                    int translated = lang < 0 ? -1 : afterNul(b, lang, end);
                    if (translated < 0) {
                        throw new DataFormatException("damaged chunk");
                    }
                    from = translated;
                }
            }
            if (from >= 0 && !inflatesWithin(b, from, end - from)) {
                return false;
            }
            if (type.equals("IEND")) {
                return true;
            }
            p = end + 4;
        }
        return true;
    }

    /** Index just after the first zero byte in [from, end), or -1. */
    private static int afterNul(byte[] b, int from, int end) {
        for (int i = from; i < end; i++) {
            if (b[i] == 0) {
                return i + 1;
            }
        }
        return -1;
    }

    private static boolean inflatesWithin(byte[] b, int off, int len) throws DataFormatException {
        Inflater inf = new Inflater();
        try {
            inf.setInput(b, off, len);
            byte[] buf = new byte[8192];
            long total = 0;
            while (!inf.finished()) {
                int n = inf.inflate(buf, 0, (int) Math.min(buf.length, MAX_METADATA_INFLATED + 1L - total));
                total += n;
                if (total > MAX_METADATA_INFLATED) {
                    return false; // stopped at 65,537 bytes
                }
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) {
                    break;
                }
            }
            return true;
        } finally {
            inf.end();
        }
    }

    /** Decodes the first image with metadata skipped; the reader's own size is checked again before any pixel is read. */
    private static BufferedImage decode(byte[] raw, Kind kind, String path) throws IOException {
        try (ImageInputStream in = new MemoryCacheImageInputStream(new ByteArrayInputStream(raw))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) {
                throw new IOException("no reader");
            }
            ImageReader r = readers.next();
            try {
                r.setInput(in, true, true); // seekForwardOnly, ignoreMetadata
                checkDimensions(r.getWidth(0), r.getHeight(0), kind, path);
                return r.read(0);
            } finally {
                r.dispose();
            }
        }
    }

    /** Applies the EXIF orientation, shrinks to {@link #MAX_LONG_SIDE}, flattens on white and writes a new JPEG. */
    private static byte[] encode(BufferedImage src, int orientation) throws IOException {
        int w = src.getWidth();
        int h = src.getHeight();
        boolean swap = orientation >= 5;
        int ow = swap ? h : w;
        int oh = swap ? w : h;
        double scale = Math.min(1.0, (double) MAX_LONG_SIDE / Math.max(ow, oh));
        int tw = Math.max(1, (int) Math.round(ow * scale));
        int th = Math.max(1, (int) Math.round(oh * scale));
        BufferedImage out = new BufferedImage(tw, th, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        try {
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, tw, th);
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            AffineTransform t = AffineTransform.getScaleInstance((double) tw / ow, (double) th / oh);
            t.concatenate(orientationTransform(orientation, w, h));
            g.drawImage(src, t, null);
        } finally {
            g.dispose();
        }
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        try {
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(JPEG_QUALITY);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (MemoryCacheImageOutputStream ios = new MemoryCacheImageOutputStream(bytes)) {
                writer.setOutput(ios);
                writer.write(null, new IIOImage(out, null, null), param); // no metadata object: no EXIF, no thumbnail
            }
            return bytes.toByteArray();
        } finally {
            writer.dispose();
        }
    }

    /** Source pixel to upright pixel for EXIF orientations 1 to 8. */
    private static AffineTransform orientationTransform(int o, int w, int h) {
        return switch (o) {
            case 2 -> new AffineTransform(-1, 0, 0, 1, w, 0);
            case 3 -> new AffineTransform(-1, 0, 0, -1, w, h);
            case 4 -> new AffineTransform(1, 0, 0, -1, 0, h);
            case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0);
            case 6 -> new AffineTransform(0, 1, -1, 0, h, 0);
            case 7 -> new AffineTransform(0, -1, -1, 0, h, w);
            case 8 -> new AffineTransform(0, -1, 1, 0, 0, w);
            default -> new AffineTransform();
        };
    }
}
