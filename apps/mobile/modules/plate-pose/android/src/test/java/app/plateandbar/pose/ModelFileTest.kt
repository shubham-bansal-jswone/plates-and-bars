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
    assertEquals(goodHash, ModelFile.sha256(file.file))
    assertEquals(ModelFile.ASSET, file.file.name)
    assertEquals(goodHash, file.sha256)
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
    assertEquals(0, dir.listFiles()!!.size) // no temp file left either
  }

  @Test fun `replaces a file on disk that was changed`() {
    val dir = tmp.newFolder()
    java.io.File(dir, ModelFile.ASSET).writeBytes("tampered".toByteArray())
    val file = ModelFile.ensure(dir, goodHash) { ByteArrayInputStream(good) }
    assertEquals(goodHash, ModelFile.sha256(file.file))
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

  @Test fun `two calls at once on an empty folder both get the good file`() {
    val dir = tmp.newFolder()
    val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
    val gate = java.util.concurrent.CountDownLatch(1)
    try {
      val jobs = (1..2).map {
        pool.submit<ModelFile.Verified> {
          gate.await()
          // a slow copy, so the two calls overlap if nothing serialises them
          ModelFile.ensure(dir, goodHash) { object : java.io.InputStream() {
            private val inner = ByteArrayInputStream(good)
            override fun read(): Int { Thread.sleep(5); return inner.read() }
          } }
        }
      }
      gate.countDown()
      val results = jobs.map { it.get(20, java.util.concurrent.TimeUnit.SECONDS) }
      results.forEach { assertEquals(goodHash, ModelFile.sha256(it.file)) }
      assertEquals(listOf(ModelFile.ASSET), dir.listFiles()!!.map { it.name })
    } finally {
      pool.shutdownNow()
    }
  }

  @Test fun `a file already verified is not hashed again`() {
    val dir = tmp.newFolder()
    val first = ModelFile.ensure(dir, goodHash) { ByteArrayInputStream(good) }
    // same size and mtime but different bytes: only a skipped hash can return it as good
    val t = first.file.lastModified()
    first.file.writeBytes("model BYTES".toByteArray())
    first.file.setLastModified(t)
    var opened = false
    val again = ModelFile.ensure(dir, goodHash) { opened = true; ByteArrayInputStream(good) }
    assertFalse(opened)
    assertEquals(goodHash, again.sha256)
  }
}
