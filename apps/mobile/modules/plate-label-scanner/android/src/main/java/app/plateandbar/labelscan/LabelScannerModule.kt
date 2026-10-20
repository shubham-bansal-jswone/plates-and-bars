package app.plateandbar.labelscan

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Nutrition-label OCR on Android (#1067, ADR 010): an image in, text lines with confidence out. No view and no camera: the screens hand
 * over the URI the camera or the system photo picker gave. Tesseract 5 runs on the coroutine CPU pool (Turn.kt), never on the UI thread or on Expo's shared async-function thread.
 * The image is read in memory and dropped; nothing is written to disk, kept, logged or sent anywhere.
 */
class LabelScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlateLabelScanner")

    // Copies the bundled language data to private storage if needed, checks its sha256 against the pinned value and reports the hash.
    AsyncFunction("verifyData") Coroutine { ->
      val context = appContext.reactContext ?: throw CodedException("ERR_OCR_NO_CONTEXT", "no_context", null)
      try {
        val data = withContext(Dispatchers.IO) { TessData.ensure(context) }
        mapOf("sha256" to data.sha256, "bytes" to data.file.length().toDouble())
      } catch (e: TessData.Mismatch) {
        throw CodedException("ERR_OCR_DATA_HASH", "data_hash_mismatch", e)
      } catch (e: TessData.Unavailable) {
        throw CodedException("ERR_OCR_DATA", "data_unavailable", e)
      }
    }

    // imageUri: a content: or file: URI. crop: fractions (0..1) of the upright image, { x, y, width, height }, or null for all of it.
    AsyncFunction("recognize") Coroutine { imageUri: String, crop: Map<String, Double>? ->
      val context = appContext.reactContext ?: throw CodedException("ERR_OCR_NO_CONTEXT", "no_context", null)
      val box = crop?.let { Crop(it["x"] ?: Double.NaN, it["y"] ?: Double.NaN, it["width"] ?: Double.NaN, it["height"] ?: Double.NaN) }
      try {
        val result = Recognizer.run(context, imageUri, box)
        mapOf("lines" to result.lines.map(::lineMap), "ms" to result.ms.toDouble())
      } catch (e: OcrException) {
        throw CodedException(e.code, e.message ?: "failed", e)
      } catch (e: TessData.Mismatch) {
        throw CodedException("ERR_OCR_DATA_HASH", "data_hash_mismatch", e)
      } catch (e: TessData.Unavailable) {
        throw CodedException("ERR_OCR_DATA", "data_unavailable", e)
      }
    }
  }

  private fun boxMap(b: Box) = mapOf("x" to b.left, "y" to b.top, "width" to b.right - b.left, "height" to b.bottom - b.top)

  private fun lineMap(l: OcrLine) = mapOf(
    "text" to l.text,
    "confidence" to l.confidence.toDouble(),
    "box" to boxMap(l.box),
    "words" to l.words.map { mapOf("text" to it.text, "confidence" to it.confidence.toDouble(), "box" to boxMap(it.box)) },
  )
}
