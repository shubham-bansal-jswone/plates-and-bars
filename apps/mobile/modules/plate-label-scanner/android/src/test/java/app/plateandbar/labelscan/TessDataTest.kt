package app.plateandbar.labelscan

import java.io.ByteArrayInputStream
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class TessDataTest {
  @get:Rule val tmp = TemporaryFolder()

  private val good = "language data".toByteArray()
  private val goodHash = TessData.sha256(ByteArrayInputStream(good))

  @Test fun `hashes like sha256 of the empty input`() {
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", TessData.sha256(ByteArrayInputStream(ByteArray(0))))
  }

  @Test fun `copies the bundled bytes into the tessdata folder Tesseract expects`() {
    val root = tmp.newFolder()
    val data = TessData.ensure(root, goodHash) { ByteArrayInputStream(good) }
    assertEquals(File(File(root, "tessdata"), "eng.traineddata"), data.file)
    assertEquals(root, data.root)
    assertEquals(goodHash, TessData.sha256(data.file))
  }

  @Test fun `refuses and leaves no file when the bytes do not match`() {
    val root = tmp.newFolder()
    try {
      TessData.ensure(root, goodHash) { ByteArrayInputStream("swapped".toByteArray()) }
      fail("should have refused")
    } catch (e: TessData.Mismatch) {
      assertEquals(TessData.sha256(ByteArrayInputStream("swapped".toByteArray())), e.actual)
    }
    assertFalse(File(root, "tessdata/eng.traineddata").exists())
    assertEquals(0, File(root, "tessdata").listFiles()!!.size) // no temp file left either
  }

  @Test fun `replaces a file on disk that was changed`() {
    val root = tmp.newFolder()
    File(root, "tessdata").mkdirs()
    File(root, "tessdata/eng.traineddata").writeBytes("tampered".toByteArray())
    val data = TessData.ensure(root, goodHash) { ByteArrayInputStream(good) }
    assertEquals(goodHash, TessData.sha256(data.file))
  }

  @Test fun `keeps a good file without reading the asset again`() {
    val root = tmp.newFolder()
    TessData.ensure(root, goodHash) { ByteArrayInputStream(good) }
    var opened = false
    TessData.ensure(root, goodHash) { opened = true; ByteArrayInputStream(good) }
    assertFalse(opened)
  }

  @Test fun `the pinned hash is a sha256`() {
    assertTrue(Regex("[0-9a-f]{64}").matches(TessData.SHA256))
  }

  @Test fun `the bundled asset is the pinned file`() {
    // The unit test runs in the module folder (android/), so the asset is read straight from the source tree.
    val asset = File("src/main/assets/${TessData.ASSET}")
    assertTrue("asset missing at ${asset.absolutePath}", asset.isFile)
    assertEquals(TessData.SHA256, TessData.sha256(asset))
  }

  @Test fun `a missing asset is Unavailable, not a raw IOException, and leaves no file`() {
    val root = tmp.newFolder()
    try {
      TessData.ensure(root, goodHash) { throw java.io.FileNotFoundException("no asset") }
      fail("should have failed")
    } catch (e: TessData.Unavailable) {
      assertEquals("data_unavailable", e.message)
    }
    assertEquals(0, File(root, "tessdata").listFiles()!!.size)
  }

  @Test fun `a copy that breaks half way is Unavailable and leaves no temp file`() {
    val root = tmp.newFolder()
    val broken = object : java.io.InputStream() {
      private var n = 0
      override fun read(): Int = if (n++ < 3) 65 else throw java.io.IOException("disk")
    }
    try {
      TessData.ensure(root, goodHash) { broken }
      fail("should have failed")
    } catch (e: TessData.Unavailable) {
      assertTrue(e.cause is java.io.IOException)
    }
    assertEquals(0, File(root, "tessdata").listFiles()!!.size)
  }

  @Test fun `a folder that cannot be written is Unavailable`() {
    val root = tmp.newFile() // a file where the folder should be: tessdata cannot be created under it
    try {
      TessData.ensure(root, goodHash) { ByteArrayInputStream(good) }
      fail("should have failed")
    } catch (e: TessData.Unavailable) {
      // expected
    }
  }

  @Test fun `the bundled bytes are read once on a first run, hashed while copying`() {
    var reads = 0
    val root = tmp.newFolder()
    TessData.ensure(root, goodHash) { reads++; ByteArrayInputStream(good) }
    assertEquals(1, reads)
  }
}
