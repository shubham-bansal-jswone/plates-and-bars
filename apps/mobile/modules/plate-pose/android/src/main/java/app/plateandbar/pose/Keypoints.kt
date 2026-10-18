package app.plateandbar.pose

/** MoveNet's 17 keypoints. The model gives [y, x, score] per point, 0..1 of the square input; JS wants x, y, score as 0..1 of the camera frame. */
object Keypoints {
  const val COUNT = 17

  /** x, y, score for each point, flattened (51 numbers), mapped back through the letterbox and kept inside the frame. */
  fun toFrame(raw: Array<Array<Array<FloatArray>>>, box: Letterbox): List<Double> {
    val out = ArrayList<Double>(COUNT * 3)
    for (k in 0 until COUNT) {
      val p = raw[0][0][k]
      val x = (p[1] * box.size - box.padX) / box.scaledWidth
      val y = (p[0] * box.size - box.padY) / box.scaledHeight
      out.add(x.coerceIn(0f, 1f).toDouble())
      out.add(y.coerceIn(0f, 1f).toDouble())
      out.add(p[2].coerceIn(0f, 1f).toDouble())
    }
    return out
  }

  fun emptyOutput(): Array<Array<Array<FloatArray>>> = Array(1) { Array(1) { Array(COUNT) { FloatArray(3) } } }
}

/** At most about 12 frames a second go through the model (10 to 15 is plenty for reps that last 2 to 4 seconds, and keeps a low-end phone cool). */
class FrameThrottle(private val minIntervalMs: Long = 80) {
  private var last = Long.MIN_VALUE

  fun accept(nowMs: Long): Boolean {
    if (last != Long.MIN_VALUE && nowMs - last < minIntervalMs) return false
    last = nowMs
    return true
  }
}
