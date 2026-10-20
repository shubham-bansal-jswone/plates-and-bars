package app.plateandbar.labelscan

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Tesseract4Android AAR is a vendored binary (libs-maven/README.md): a changed or swapped file must fail the build. */
class VendoredAarTest {
  private val aar = File("libs-maven/app/plateandbar/vendor/tesseract4android/4.9.0/tesseract4android-4.9.0.aar")

  @Test fun `the vendored AAR is the pinned file`() {
    // The unit test runs in the module folder (android/), so the file is read straight from the source tree.
    assertTrue("AAR missing at ${aar.absolutePath}", aar.isFile)
    assertEquals(12_850_019L, aar.length())
    assertEquals("e6226ad06b34aaf4ab4f642d2b8e40fa86172e84bd4e5fc9066d2217472bc78a", TessData.sha256(aar))
  }
}
