package app.plateandbar.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.plateandbar.api.common.ApiException;
import app.plateandbar.api.common.ErrorResponse;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** A PNG with a bit depth above 8 is refused on its header, before a permit and before any decode (#1010). */
class AiImagesBitDepthTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static byte[] png(int type) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(16, 16, type), "png", out);
        return out.toByteArray();
    }

    private static ObjectNode slot(String mediaType, byte[] bytes) {
        return JSON.createObjectNode().put("media_type", mediaType).put("data", Base64.getEncoder().encodeToString(bytes));
    }

    @Test
    void aSixteenBitPngWithinTheLimitsIsRefusedWithoutTakingAPermit() throws Exception {
        byte[] sixteen = png(BufferedImage.TYPE_USHORT_GRAY);
        assertThat(sixteen[24] & 0xFF).as("IHDR bit depth of the fixture").isEqualTo(16);
        // Both permits are held: a request that reached the permit would wait 2 s and then be 503.
        AiImages.PERMITS.acquire(AiImages.MAX_CONCURRENT);
        try {
            long start = System.nanoTime();
            assertThatThrownBy(() -> AiImages.reencode(slot("image/png", sixteen), "image", AiImages.Kind.PHOTO))
                    .isInstanceOf(ApiException.class)
                    .satisfies(t -> {
                        ApiException e = (ApiException) t;
                        assertThat(e.status().value()).isEqualTo(400);
                        assertThat(e.code()).isEqualTo("invalid_request");
                        assertThat(e.details()).containsExactly(new ErrorResponse.Detail("image.data", "unreadable_image"));
                    });
            assertThat((System.nanoTime() - start) / 1_000_000).as("did not wait for a permit").isLessThan(AiImages.PERMIT_WAIT_MS);
        } finally {
            AiImages.PERMITS.release(AiImages.MAX_CONCURRENT);
        }
        assertThat(AiImages.PERMITS.availablePermits()).isEqualTo(AiImages.MAX_CONCURRENT);
    }

    @Test
    void anEightBitPngIsStillDecodedUnderAPermitAndAJpegIsToo() throws Exception {
        for (byte[] ok : new byte[][] {png(BufferedImage.TYPE_INT_RGB), png(BufferedImage.TYPE_BYTE_GRAY), png(BufferedImage.TYPE_INT_ARGB)}) {
            assertThat(ok[24] & 0xFF).isEqualTo(8);
            assertThat(AiImages.reencode(slot("image/png", ok), "image", AiImages.Kind.PHOTO)[1] & 0xFF).isEqualTo(0xD8);
        }
        ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB), "jpeg", jpeg);
        assertThat(AiImages.reencode(slot("image/jpeg", jpeg.toByteArray()), "image", AiImages.Kind.PHOTO)[1] & 0xFF).isEqualTo(0xD8);
    }

    @Test
    void aSixteenBitPngOverTheLimitsStillGetsDimensions() throws Exception {
        byte[] big = png(BufferedImage.TYPE_USHORT_GRAY);
        big[18] = 0x20; // width 0x2010: over 4,096
        assertThatThrownBy(() -> AiImages.reencode(slot("image/png", big), "image", AiImages.Kind.PHOTO))
                .satisfies(t -> assertThat(((ApiException) t).details().get(0).issue()).isEqualTo("dimensions"));
    }
}
