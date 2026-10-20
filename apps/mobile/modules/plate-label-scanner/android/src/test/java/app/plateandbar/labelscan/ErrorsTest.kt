package app.plateandbar.labelscan

import java.io.FileNotFoundException
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ErrorsTest {
  private fun codeOf(block: () -> Unit): String = try {
    imageIo(block)
    "none"
  } catch (e: OcrException) {
    assertEquals("image_unreadable", e.message)
    e.code
  }

  @Test fun `a missing file is ERR_OCR_IMAGE`() {
    assertEquals("ERR_OCR_IMAGE", codeOf { throw FileNotFoundException("/data/x/label.jpg") })
  }

  @Test fun `any other I-O failure and a refused content URI are ERR_OCR_IMAGE`() {
    assertEquals("ERR_OCR_IMAGE", codeOf { throw IOException("read") })
    assertEquals("ERR_OCR_IMAGE", codeOf { throw SecurityException("permission") })
  }

  @Test fun `the message never carries the path`() {
    try {
      imageIo<Unit> { throw FileNotFoundException("/data/x/label.jpg") }
      fail("should have thrown")
    } catch (e: OcrException) {
      assertTrue(!e.message!!.contains("label"))
    }
  }

  @Test fun `an OcrException passes through unchanged and a value is returned as is`() {
    val own = OcrException("ERR_OCR_CROP", "crop_invalid")
    try {
      imageIo<Unit> { throw own }
      fail("should have thrown")
    } catch (e: OcrException) {
      assertSame(own, e)
    }
    assertEquals(7, imageIo { 7 })
  }
}
