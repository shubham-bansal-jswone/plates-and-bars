package app.plateandbar.pose

import android.content.Context
import java.io.File
import java.io.InputStream
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

  /** The verified model file in the app's private storage (not backed up, not shared). Copies the asset when the file is missing or wrong. */
  fun ensure(context: Context): File {
    val dir = File(context.noBackupFilesDir, "plate-pose")
    return ensure(dir, expected = SHA256) { context.assets.open(ASSET) }
  }

  /** Testable core of [ensure]: `open` gives the bundled bytes. Throws [Mismatch] when what was copied does not hash to `expected`. */
  fun ensure(dir: File, expected: String, open: () -> InputStream): File {
    dir.mkdirs()
    val target = File(dir, ASSET)
    if (target.isFile && sha256(target) == expected) return target
    val tmp = File(dir, "$ASSET.tmp")
    open().use { src -> tmp.outputStream().use { out -> src.copyTo(out) } }
    val actual = sha256(tmp)
    if (actual != expected) {
      tmp.delete()
      target.delete()
      throw Mismatch(actual)
    }
    if (!tmp.renameTo(target)) {
      target.delete()
      if (!tmp.renameTo(target)) throw IllegalStateException("model_copy_failed")
    }
    return target
  }
}
