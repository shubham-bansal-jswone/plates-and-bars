package app.plateandbar.pose

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeypointsTest {
  @Test fun `maps y, x, score of the square input to x, y, score of the frame through the letterbox`() {
    // a 16 x 8 frame in a 192 square: scaled 192 x 96, bands of 48 above and below
    val box = Letterbox(16, 8, 192, 96, 0, 48, 192)
    val raw = Keypoints.emptyOutput()
    raw[0][0][0] = floatArrayOf(0.5f, 0.25f, 0.9f) // y = middle of the square, x = a quarter across
    val out = Keypoints.toFrame(raw, box)
    assertEquals(51, out.size)
    assertEquals(0.25, out[0], 1e-6)
    assertEquals(0.5, out[1], 1e-6)
    assertEquals(0.9, out[2], 1e-6)
  }

  @Test fun `keeps points that fall in the black band inside the frame`() {
    val box = Letterbox(16, 8, 192, 96, 0, 48, 192)
    val raw = Keypoints.emptyOutput()
    raw[0][0][3] = floatArrayOf(0.0f, 1.2f, 0.4f)
    val out = Keypoints.toFrame(raw, box)
    assertEquals(1.0, out[9], 0.0)
    assertEquals(0.0, out[10], 0.0)
  }

  @Test fun `lets a frame through at most every 80 ms`() {
    val t = FrameThrottle(80)
    assertTrue(t.accept(1000))
    assertFalse(t.accept(1040))
    assertFalse(t.accept(1079))
    assertTrue(t.accept(1080))
    assertTrue(t.accept(5000))
  }
}
