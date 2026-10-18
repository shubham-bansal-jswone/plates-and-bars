package app.plateandbar.pose

import android.content.Context
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/**
 * The MoveNet Lightning float16 model (Apache-2.0, Google), bundled in the APK as an asset and loaded from a file path, never from the
 * network. The hash below is pinned: a file that does not match is deleted and refused, so a corrupted or swapped model never runs (#947).
 * src/pose/pose-native.ts pins the same value; a jest test keeps the two, and the asset itself, in step.
 */
object ModelFile {
  const val ASSET = "movenet_lightning_f16.tflite"
  const val SHA256 = "0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab"

  class Mismatch(val actual: String) : Exception("model_hash_mismatch")

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

  /** A model file whose sha256 was checked: `sha256` is the value it was checked against. */
  class Verified(val file: File, val sha256: String)

  // One lock for the whole process: verifyModel() (module queue) and the view's analysis thread can both call ensure() on a first run.
  private val lock = Any()
  // What was last verified, so each start hashes the 4.7 MB file once at most: the same path, size and mtime are trusted again.
  private var cachedPath: String? = null
  private var cachedSize = -1L
  private var cachedTime = -1L

  /** The verified model file in the app's private storage (not backed up, not shared). Copies the asset when the file is missing or wrong. */
  fun ensure(context: Context): Verified {
    val dir = File(context.noBackupFilesDir, "plate-pose")
    return ensure(dir, expected = SHA256) { context.assets.open(ASSET) }
  }

  /** Testable core of [ensure]: `open` gives the bundled bytes. Throws [Mismatch] when what was copied does not hash to `expected`. */
  fun ensure(dir: File, expected: String, open: () -> InputStream): Verified = synchronized(lock) {
    dir.mkdirs()
    val target = File(dir, ASSET)
    if (target.isFile && cachedPath == target.path && cachedSize == target.length() && cachedTime == target.lastModified()) return Verified(target, expected)
    if (target.isFile && sha256(target) == expected) return remember(target, expected)
    // A unique temp name, then an atomic rename: a reader never sees a half-written model.
    val tmp = File.createTempFile(ASSET, ".tmp", dir)
    try {
      open().use { src -> tmp.outputStream().use { out -> src.copyTo(out) } }
      val actual = sha256(tmp)
      if (actual != expected) {
        target.delete()
        throw Mismatch(actual)
      }
      Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    } finally {
      tmp.delete()
    }
    remember(target, expected)
  }

  private fun remember(target: File, expected: String): Verified {
    cachedPath = target.path
    cachedSize = target.length()
    cachedTime = target.lastModified()
    return Verified(target, expected)
  }
}
