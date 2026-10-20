package app.plateandbar.labelscan

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A crop box as fractions (0..1) of the upright image: left, top, width, height. */
data class Crop(val x: Double, val y: Double, val width: Double, val height: Double)

data class PixelRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val width get() = right - left
  val height get() = bottom - top
}

/** Pure arithmetic for reading only the part of a photo that is asked for, kept apart from android.graphics so it is unit tested. */
object Geometry {
  /** The smallest crop side in pixels that is still worth reading. */
  const val MIN_SIDE = 16

  /** EXIF orientations 5 to 8 turn the picture a quarter turn: the upright image has its width and height swapped. */
  fun swapsSides(orientation: Int) = orientation in 5..8

  /**
   * The raw (as stored) pixel rectangle of the crop, given as fractions of the upright image. `null` crop is the whole image.
   * Throws [IllegalArgumentException] for a box that is not finite, empty or outside the image, or smaller than [MIN_SIDE].
   */
  fun cropToRaw(crop: Crop?, rawW: Int, rawH: Int, orientation: Int): PixelRect {
    require(rawW > 0 && rawH > 0) { "empty image" }
    val uw = if (swapsSides(orientation)) rawH else rawW
    val uh = if (swapsSides(orientation)) rawW else rawH
    val c = crop ?: Crop(0.0, 0.0, 1.0, 1.0)
    require(c.x.isFinite() && c.y.isFinite() && c.width.isFinite() && c.height.isFinite()) { "crop not finite" }
    require(c.x >= 0 && c.y >= 0 && c.width > 0 && c.height > 0 && c.x < 1 && c.y < 1) { "crop outside the image" }
    val u0 = (c.x * uw).roundToInt().coerceIn(0, uw)
    val v0 = (c.y * uh).roundToInt().coerceIn(0, uh)
    val u1 = ((c.x + c.width) * uw).roundToInt().coerceIn(0, uw)
    val v1 = ((c.y + c.height) * uh).roundToInt().coerceIn(0, uh)
    require(u1 - u0 >= MIN_SIDE && v1 - v0 >= MIN_SIDE) { "crop too small" }
    // Map two opposite corners from upright back to raw coordinates, then order them.
    val (xa, ya) = uprightToRaw(u0, v0, rawW, rawH, orientation)
    val (xb, yb) = uprightToRaw(u1, v1, rawW, rawH, orientation)
    return PixelRect(min(xa, xb), min(ya, yb), max(xa, xb), max(ya, yb))
  }

  /** Inverse of the EXIF orientation transform on a point (corner coordinates, 0..size). */
  fun uprightToRaw(u: Int, v: Int, rawW: Int, rawH: Int, orientation: Int): Pair<Int, Int> = when (orientation) {
    2 -> Pair(rawW - u, v)
    3 -> Pair(rawW - u, rawH - v)
    4 -> Pair(u, rawH - v)
    5 -> Pair(v, u)
    6 -> Pair(v, rawH - u)
    7 -> Pair(rawW - v, rawH - u)
    8 -> Pair(rawW - v, u)
    else -> Pair(u, v)
  }

  /** The power-of-two `inSampleSize` that brings the longer side to `maxEdge` or less (1 when it already fits). */
  fun sampleSize(width: Int, height: Int, maxEdge: Int): Int {
    var s = 1
    while (max(width, height) / s > maxEdge) s *= 2
    return s
  }
}
