package app.plateandbar.labelscan

import android.content.Context
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

/**
 * The tessdata_fast English model (Apache-2.0, 4.1 MB), bundled in the APK as an asset and copied to private storage on first use, never
 * fetched from the network. Tesseract wants `<dataPath>/tessdata/eng.traineddata`, so the file lives in that layout. The hash below is
 * pinned: a copy that does not match is deleted and refused, so a corrupted or swapped model never runs (ADR 010).
 * The web build pins the same value (src/labelscan/webAssets.ts); a jest test keeps the two and the asset in step.
 */
object TessData {
  const val ASSET = "eng.traineddata"
  const val LANG = "eng"
  const val SHA256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"

  class Mismatch(val actual: String) : Exception("data_hash_mismatch")

  /** The bundled data could not be read or copied (asset missing, disk full, rename failed). The message is a fixed code. */
  class Unavailable(cause: Throwable? = null) : Exception("data_unavailable", cause)

  fun sha256(file: File): String = file.inputStream().use { sha256(it) }

  fun sha256(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    while (true) {
      val n = input.read(buf)
      if (n < 0) break
      digest.update(buf, 0, n)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /** Copies `src` to `out` and returns the sha256 of what was copied, in one pass. */
  private fun copyAndHash(src: InputStream, out: OutputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    while (true) {
      val n = src.read(buf)
      if (n < 0) break
      digest.update(buf, 0, n)
      out.write(buf, 0, n)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /** `root` is the `dataPath` to give Tesseract; `file` is the verified model inside it; `sha256` is the value it was checked against. */
  class Verified(val root: File, val file: File, val sha256: String)

  // One lock for the whole process: verifyData() and recognize() can both reach ensure() on a first run.
  private val lock = Any()
  // What was last verified, so each scan hashes the 4 MB file at most once: the same path, size and mtime are trusted again.
  private var cachedPath: String? = null
  private var cachedSize = -1L
  private var cachedTime = -1L

  /** The verified model in the app's private storage (not backed up, not shared). Copies the asset when the file is missing or wrong. */
  fun ensure(context: Context): Verified = ensure(File(context.noBackupFilesDir, "plate-label-scanner"), SHA256) { context.assets.open(ASSET) }

  /** Testable core of [ensure]: `open` gives the bundled bytes. Throws [Mismatch] when what was copied does not hash to `expected`. */
  fun ensure(root: File, expected: String, open: () -> InputStream): Verified = synchronized(lock) {
    val dir = File(root, "tessdata")
    dir.mkdirs()
    val target = File(dir, ASSET)
    if (target.isFile && cachedPath == target.path && cachedSize == target.length() && cachedTime == target.lastModified()) return Verified(root, target, expected)
    if (target.isFile && sha256(target) == expected) return remember(root, target, expected)
    // A unique temp name, then an atomic rename: a reader never sees a half-written model.
    try {
      val tmp = File.createTempFile(ASSET, ".tmp", dir)
      try {
        val actual = open().use { src -> tmp.outputStream().use { out -> copyAndHash(src, out) } } // hashed while copying
        if (actual != expected) {
          target.delete()
          throw Mismatch(actual)
        }
        // File.renameTo is a rename(2) on Android: it replaces the target in one step. (the NIO Files API needs API 26; minSdk is 24.)
        if (!tmp.renameTo(target)) throw Unavailable()
      } finally {
        tmp.delete()
      }
    } catch (e: IOException) {
      throw Unavailable(e) // asset missing, disk full, no write access
    }
    remember(root, target, expected)
  }

  private fun remember(root: File, target: File, expected: String): Verified {
    cachedPath = target.path
    cachedSize = target.length()
    cachedTime = target.lastModified()
    return Verified(root, target, expected)
  }
}
