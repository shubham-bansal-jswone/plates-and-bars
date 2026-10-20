package app.plateandbar.labelscan

import java.io.IOException

/** Why a scan failed. `code` is the Expo error code; the message is a fixed code, never the path, the pixels or the text. */
class OcrException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

/** Runs a read of the image; a missing file, a refused content URI or any other I/O failure is `ERR_OCR_IMAGE`, not an unnamed crash. */
inline fun <T> imageIo(block: () -> T): T = try {
  block()
} catch (e: OcrException) {
  throw e
} catch (e: IOException) { // includes FileNotFoundException
  throw OcrException("ERR_OCR_IMAGE", "image_unreadable", e)
} catch (e: SecurityException) {
  throw OcrException("ERR_OCR_IMAGE", "image_unreadable", e)
}
