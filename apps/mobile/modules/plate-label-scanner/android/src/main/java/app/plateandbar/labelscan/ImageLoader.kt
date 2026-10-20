package app.plateandbar.labelscan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Matrix
import android.graphics.Rect
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.InputStream

/**
 * Decodes the photo the camera or the system picker handed over, in memory only: nothing is written to disk. Only the cropped part is
 * decoded (BitmapRegionDecoder) and at most [MAX_EDGE] pixels on its long side, so a 12 MP photo costs about as much as a 2 MP one.
 */
object ImageLoader {
  /** Long side of the bitmap given to the engine. Tesseract reads print best near 300 dpi; a larger bitmap only costs memory on a 2 GB phone. */
  const val MAX_EDGE = 2400

  fun load(context: Context, uriText: String, crop: Crop?): Bitmap {
    val uri = Uri.parse(uriText)
    // Only what the camera or the picker gives: a content or file URI. Never a network address.
    if (uri.scheme != "content" && uri.scheme != "file") throw OcrException("ERR_OCR_IMAGE", "image_unreadable")
    val resolver = context.contentResolver
    fun open(): InputStream = resolver.openInputStream(uri) ?: throw OcrException("ERR_OCR_IMAGE", "image_unreadable")

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    try {
      open().use { BitmapFactory.decodeStream(it, null, bounds) }
    } catch (e: OcrException) {
      throw e
    } catch (e: Exception) {
      throw OcrException("ERR_OCR_IMAGE", "image_unreadable", e)
    }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw OcrException("ERR_OCR_IMAGE", "image_unreadable")

    val orientation = try {
      open().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    } catch (e: Exception) {
      ExifInterface.ORIENTATION_NORMAL // a format with no EXIF (PNG, WebP) or a damaged header: read it as stored
    }

    val rect = try {
      Geometry.cropToRaw(crop, bounds.outWidth, bounds.outHeight, orientation)
    } catch (e: IllegalArgumentException) {
      throw OcrException("ERR_OCR_CROP", "crop_invalid", e)
    }

    val region = decodeRegion(::open, rect) ?: imageIo { decodeWhole(::open, rect, crop) }
    return upright(region, orientation)
  }

  // Decodes just the crop rectangle. Null when the format has no region decoder (some HEIF on old Android), then the caller decodes the whole image.
  @Suppress("DEPRECATION")
  private fun decodeRegion(open: () -> InputStream, rect: PixelRect): Bitmap? = try {
    open().use { stream ->
      val decoder = BitmapRegionDecoder.newInstance(stream, false) ?: return null
      try {
        val opts = BitmapFactory.Options().apply { inSampleSize = Geometry.sampleSize(rect.width, rect.height, MAX_EDGE) }
        decoder.decodeRegion(Rect(rect.left, rect.top, rect.right, rect.bottom), opts)
      } finally {
        decoder.recycle()
      }
    }
  } catch (e: Exception) {
    null
  }

  // Fallback: decode the whole image at reduced size, then cut out the crop. `rect` is in raw pixels, so it scales with the sample size.
  private fun decodeWhole(open: () -> InputStream, rect: PixelRect, crop: Crop?): Bitmap {
    val sample = Geometry.sampleSize(rect.width, rect.height, MAX_EDGE)
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val whole = open().use { BitmapFactory.decodeStream(it, null, opts) } ?: throw OcrException("ERR_OCR_IMAGE", "image_unreadable")
    // Rounded down to the sample grid; the decoded bitmap is `ceil(size / sample)` pixels.
    val l = (rect.left / sample).coerceIn(0, whole.width - 1)
    val t = (rect.top / sample).coerceIn(0, whole.height - 1)
    val r = (rect.right / sample).coerceIn(l + 1, whole.width)
    val b = (rect.bottom / sample).coerceIn(t + 1, whole.height)
    if (crop == null && l == 0 && t == 0 && r == whole.width && b == whole.height) return whole
    val cut = Bitmap.createBitmap(whole, l, t, r - l, b - t)
    if (cut !== whole) whole.recycle()
    return cut
  }

  private fun upright(bitmap: Bitmap, orientation: Int): Bitmap {
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> { m.setRotate(180f); m.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_TRANSPOSE -> { m.setRotate(90f); m.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> m.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { m.setRotate(270f); m.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> m.setRotate(270f)
      else -> return bitmap
    }
    val turned = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
    if (turned !== bitmap) bitmap.recycle()
    return turned
  }
}
