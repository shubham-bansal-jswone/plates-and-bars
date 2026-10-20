package app.plateandbar.labelscan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class GeometryTest {
  @Test fun `no crop is the whole raw image`() {
    assertEquals(PixelRect(0, 0, 400, 300), Geometry.cropToRaw(null, 400, 300, 1))
  }

  @Test fun `a crop on an upright image is in raw pixels directly`() {
    assertEquals(PixelRect(100, 150, 300, 300), Geometry.cropToRaw(Crop(0.25, 0.5, 0.5, 0.5), 400, 300, 1))
  }

  @Test fun `a phone photo stored sideways (orientation 6) maps the upright crop back to the raw frame`() {
    // Raw 400 x 300, shown rotated a quarter turn clockwise: upright is 300 wide and 400 tall. The upright top-left quarter
    // (0..150 across, 0..200 down) is the raw bottom-left: x from 0..200, y from 150..300.
    assertEquals(PixelRect(0, 150, 200, 300), Geometry.cropToRaw(Crop(0.0, 0.0, 0.5, 0.5), 400, 300, 6))
  }

  @Test fun `the whole upright image is the whole raw image for every orientation`() {
    for (o in 1..8) assertEquals("orientation $o", PixelRect(0, 0, 400, 300), Geometry.cropToRaw(Crop(0.0, 0.0, 1.0, 1.0), 400, 300, o))
  }

  @Test fun `a crop keeps its area for every orientation`() {
    for (o in 1..8) {
      val r = Geometry.cropToRaw(Crop(0.1, 0.2, 0.5, 0.4), 400, 300, o)
      val area = r.width * r.height
      assertEquals("orientation $o", Math.round(0.5 * 0.4 * 400 * 300).toInt(), area)
    }
  }

  @Test fun `orientation 3 flips both ways and 8 turns the other way`() {
    assertEquals(PixelRect(200, 150, 400, 300), Geometry.cropToRaw(Crop(0.0, 0.0, 0.5, 0.5), 400, 300, 3))
    // upright is 300 x 400; its top-left quarter is the raw top-right x 200..400 (width 200), y 0..150
    assertEquals(PixelRect(200, 0, 400, 150), Geometry.cropToRaw(Crop(0.0, 0.0, 0.5, 0.5), 400, 300, 8))
  }

  @Test fun `refuses boxes that are not finite, empty or outside the image`() {
    val bad = listOf(Crop(Double.NaN, 0.0, 0.5, 0.5), Crop(-0.1, 0.0, 0.5, 0.5), Crop(0.0, 0.0, 0.0, 0.5), Crop(1.0, 0.0, 0.5, 0.5), Crop(0.0, 0.0, Double.POSITIVE_INFINITY, 0.5))
    for (c in bad) {
      try {
        Geometry.cropToRaw(c, 400, 300, 1)
        fail("should refuse $c")
      } catch (e: IllegalArgumentException) {
        assertTrue(e.message!!.startsWith("crop"))
      }
    }
  }

  @Test fun `a box that runs past the edge is clipped, and a sliver is refused`() {
    assertEquals(PixelRect(200, 150, 400, 300), Geometry.cropToRaw(Crop(0.5, 0.5, 0.9, 0.9), 400, 300, 1))
    try {
      Geometry.cropToRaw(Crop(0.0, 0.0, 0.01, 1.0), 400, 300, 1)
      fail("a 4 px wide strip should be refused")
    } catch (e: IllegalArgumentException) {
      assertEquals("crop too small", e.message)
    }
  }

  @Test fun `sample size is the power of two that fits the long side`() {
    assertEquals(1, Geometry.sampleSize(2400, 1800, 2400))
    assertEquals(2, Geometry.sampleSize(2401, 100, 2400))
    assertEquals(2, Geometry.sampleSize(4000, 3000, 2400))
    assertEquals(4, Geometry.sampleSize(8000, 6000, 2400))
  }
}
