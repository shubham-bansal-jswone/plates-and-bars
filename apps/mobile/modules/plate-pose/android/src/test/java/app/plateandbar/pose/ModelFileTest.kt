package app.plateandbar.pose

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ModelFileTest {
  @get:Rule val tmp = TemporaryFolder()

  private val good = "model bytes".toByteArray()
  private val goodHash = ModelFile.sha256(ByteArrayInputStream(good))

  @Test fun `hashes like sha256 of the empty input`() {
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ModelFile.sha256(ByteArrayInputStream(ByteArray(0))))
  }

  @Test fun `copies the bundled bytes when they match the pinned hash`() {
    val file = ModelFile.ensure(tmp.newFolder(), goodHash) { ByteArrayInputStream(good) }
    assertEquals(goodHash, ModelFile.sha256(file))
    assertEquals(ModelFile.ASSET, file.name)
  }

  @Test fun `refuses and leaves no file when the bytes do not match`() {
    val dir = tmp.newFolder()
    try {
      ModelFile.ensure(dir, goodHash) { ByteArrayInputStream("swapped".toByteArray()) }
      fail("should have refused")
    } catch (e: ModelFile.Mismatch) {
      assertEquals(ModelFile.sha256(ByteArrayInputStream("swapped".toByteArray())), e.actual)
    }
    assertFalse(java.io.File(dir, ModelFile.ASSET).exists())
    assertFalse(java.io.File(dir, "${ModelFile.ASSET}.tmp").exists())
  }

  @Test fun `replaces a file on disk that was changed`() {
    val dir = tmp.newFolder()
    java.io.File(dir, ModelFile.ASSET).writeBytes("tampered".toByteArray())
    val file = ModelFile.ensure(dir, goodHash) { ByteArrayInputStream(good) }
    assertEquals(goodHash, ModelFile.sha256(file))
  }

  @Test fun `keeps a good file without reading the asset again`() {
    val dir = tmp.newFolder()
    ModelFile.ensure(dir, goodHash) { ByteArrayInputStream(good) }
    var opened = false
    ModelFile.ensure(dir, goodHash) { opened = true; ByteArrayInputStream(good) }
    assertFalse(opened)
  }

  @Test fun `the pinned hash is a sha256`() {
    assertTrue(Regex("[0-9a-f]{64}").matches(ModelFile.SHA256))
  }
}
