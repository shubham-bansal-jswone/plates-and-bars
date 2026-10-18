package app.plateandbar.pose

import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Test

class FrameConverterTest {
  /** An RGBA frame where pixel (x, y) is (x, y, 7, 255), so every output byte says which source pixel it came from. */
  private fun frame(w: Int, h: Int, rowStride: Int = w * 4): ByteBuffer {
    val b = ByteBuffer.allocate(rowStride * h)
    for (y in 0 until h) for (x in 0 until w) {
      b.put(y * rowStride + x * 4, x.toByte())
      b.put(y * rowStride + x * 4 + 1, y.toByte())
      b.put(y * rowStride + x * 4 + 2, 7)
      b.put(y * rowStride + x * 4 + 3, -1)
    }
    return b
  }

  private fun px(c: FrameConverter, x: Int, y: Int): Triple<Int, Int, Int> {
    val i = (y * c.size + x) * 3
    return Triple(c.input.get(i).toInt() and 0xff, c.input.get(i + 1).toInt() and 0xff, c.input.get(i + 2).toInt() and 0xff)
  }

  @Test fun `fits a landscape frame in the middle of the square with black bands, dropping the alpha`() {
    val c = FrameConverter(8)
    val box = c.convert(frame(16, 8), 16 * 4, 4, 16, 8, 0)
    assertEquals(16, box.frameWidth); assertEquals(8, box.frameHeight)
    assertEquals(8, box.scaledWidth); assertEquals(4, box.scaledHeight)
    assertEquals(0, box.padX); assertEquals(2, box.padY)
    assertEquals(Triple(0, 0, 0), px(c, 3, 0)) // band above
    assertEquals(Triple(0, 0, 0), px(c, 3, 7)) // band below
    // top-left of the scaled image is source (1, 1): the pixel centre of its first 2 x 2 block
    assertEquals(Triple(1, 1, 7), px(c, 0, 2))
    assertEquals(Triple(15, 7, 7), px(c, 7, 5))
    assertEquals(8 * 8 * 3, c.input.capacity())
    assertEquals(0, c.input.position())
  }

  @Test fun `honours the row stride`() {
    val c = FrameConverter(4)
    c.convert(frame(4, 4, rowStride = 4 * 4 + 12), 4 * 4 + 12, 4, 4, 4, 0)
    assertEquals(Triple(2, 3, 7), px(c, 2, 3))
  }

  @Test fun `turns the frame upright for each rotation`() {
    // a 4 x 2 sensor frame, shown 90 degrees clockwise: upright it is 2 wide and 4 tall
    val c = FrameConverter(4)
    val box90 = c.convert(frame(4, 2), 16, 4, 4, 2, 90)
    assertEquals(2, box90.frameWidth); assertEquals(4, box90.frameHeight)
    // upright (0, 0) comes from source (0, srcH - 1 - 0) = (0, 1)
    assertEquals(Triple(0, 1, 7), px(c, box90.padX, box90.padY))
    // upright (1, 3) comes from source (3, 0)
    assertEquals(Triple(3, 0, 7), px(c, box90.padX + 1, box90.padY + 3))

    val box270 = c.convert(frame(4, 2), 16, 4, 4, 2, 270)
    // upright (0, 0) comes from source (srcW - 1, 0) = (3, 0)
    assertEquals(Triple(3, 0, 7), px(c, box270.padX, box270.padY))
    assertEquals(Triple(0, 1, 7), px(c, box270.padX + 1, box270.padY + 3))

    val box180 = c.convert(frame(4, 2), 16, 4, 4, 2, 180)
    assertEquals(4, box180.frameWidth)
    assertEquals(Triple(3, 1, 7), px(c, box180.padX, box180.padY))
  }

  @Test fun `clears the bands from an earlier frame`() {
    val c = FrameConverter(4)
    c.convert(frame(4, 4), 16, 4, 4, 4, 0)
    c.convert(frame(4, 2), 16, 4, 4, 2, 0)
    assertEquals(Triple(0, 0, 0), px(c, 0, 0))
  }
}
