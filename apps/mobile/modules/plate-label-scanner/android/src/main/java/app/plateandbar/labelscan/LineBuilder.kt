package app.plateandbar.labelscan

data class Box(val left: Int, val top: Int, val right: Int, val bottom: Int)

/** Confidence is Tesseract's 0..100 (higher is surer). Boxes are pixels of the image that was read (the crop, upright). */
data class OcrWord(val text: String, val confidence: Float, val box: Box)

data class OcrLine(val text: String, val confidence: Float, val box: Box, val words: List<OcrWord>)

/** Collects words in reading order into lines. Pure, so it is unit tested without the engine. */
class LineBuilder {
  private val lines = ArrayList<OcrLine>()
  private var current = ArrayList<OcrWord>()

  /** Adds a word; `endsLine` is true for the last word of a text line. Words with no text are dropped (the engine reports blank ones). */
  fun add(word: OcrWord, endsLine: Boolean) {
    if (word.text.isNotBlank()) current.add(word.copy(text = word.text.trim(), confidence = word.confidence.coerceIn(0f, 100f)))
    if (endsLine) flush()
  }

  fun lines(): List<OcrLine> {
    flush()
    return lines
  }

  private fun flush() {
    if (current.isEmpty()) return
    val words = current
    current = ArrayList()
    val box = Box(words.minOf { it.box.left }, words.minOf { it.box.top }, words.maxOf { it.box.right }, words.maxOf { it.box.bottom })
    val confidence = words.map { it.confidence }.average().toFloat()
    lines.add(OcrLine(words.joinToString(" ") { it.text }, confidence, box, words))
  }
}
