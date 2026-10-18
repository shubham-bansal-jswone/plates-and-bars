package app.plateandbar.pose

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Where the upright frame sits inside the square model input: scaled to fit, centred, the rest black. */
class Letterbox(val frameWidth: Int, val frameHeight: Int, val scaledWidth: Int, val scaledHeight: Int, val padX: Int, val padY: Int, val size: Int)

/**
 * CPU conversion of one camera frame to the model's input: RGBA bytes (CameraX `OUTPUT_IMAGE_FORMAT_RGBA_8888`), turned upright by the
 * frame's rotation, scaled to fit a size x size square without changing the aspect ratio (nearest pixel), as uint8 RGB. No image object and no
 * file: the frame is read from the camera buffer and the result lives in one reused direct buffer.
 */
class FrameConverter(val size: Int = 192) {
  val input: ByteBuffer = ByteBuffer.allocateDirect(size * size * 3).order(ByteOrder.nativeOrder())
  private val bytes = ByteArray(size * size * 3)

  /** `rgba` is the plane's buffer (absolute reads only: its position is not touched). `rotation` is 0, 90, 180 or 270 degrees clockwise to make the frame upright. */
  fun convert(rgba: ByteBuffer, rowStride: Int, pixelStride: Int, srcW: Int, srcH: Int, rotation: Int): Letterbox {
    val upW = if (rotation % 180 == 0) srcW else srcH
    val upH = if (rotation % 180 == 0) srcH else srcW
    val scale = size.toDouble() / maxOf(upW, upH)
    val sw = maxOf(1, minOf(size, Math.round(upW * scale).toInt()))
    val sh = maxOf(1, minOf(size, Math.round(upH * scale).toInt()))
    val padX = (size - sw) / 2
    val padY = (size - sh) / 2
    java.util.Arrays.fill(bytes, 0)
    for (oy in 0 until sh) {
      val uy = minOf(upH - 1, ((oy + 0.5) * upH / sh).toInt())
      for (ox in 0 until sw) {
        val ux = minOf(upW - 1, ((ox + 0.5) * upW / sw).toInt())
        val sx: Int
        val sy: Int
        when (rotation) {
          90 -> { sx = uy; sy = srcH - 1 - ux }
          180 -> { sx = srcW - 1 - ux; sy = srcH - 1 - uy }
          270 -> { sx = srcW - 1 - uy; sy = ux }
          else -> { sx = ux; sy = uy }
        }
        val from = sy * rowStride + sx * pixelStride
        val to = ((oy + padY) * size + ox + padX) * 3
        bytes[to] = rgba.get(from)
        bytes[to + 1] = rgba.get(from + 1)
        bytes[to + 2] = rgba.get(from + 2)
      }
    }
    input.clear()
    input.put(bytes)
    input.rewind()
    return Letterbox(upW, upH, sw, sh, padX, padY, size)
  }
}
