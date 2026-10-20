package app.plateandbar.labelscan

import android.content.Context
import com.googlecode.tesseract.android.ResultIterator
import com.googlecode.tesseract.android.TessBaseAPI
import com.googlecode.tesseract.android.TessBaseAPI.PageIteratorLevel

class OcrResult(val lines: List<OcrLine>, val ms: Long)

/**
 * One scan: decode the (cropped) image in memory, run Tesseract 5 (LSTM) on it, and give back lines with confidence (ADR 010).
 * Everything the engine allocated is freed before this returns, so nothing stays resident between scans. The image and the recognised
 * text are never logged or written anywhere, and exception messages are fixed codes.
 */
object Recognizer {
  suspend fun run(context: Context, imageUri: String, crop: Crop?): OcrResult = Turn.run {
    try {
      scan(context, imageUri, crop)
    } catch (e: OutOfMemoryError) {
      throw OcrException("ERR_OCR_MEMORY", "out_of_memory", e)
    }
  }

  private fun scan(context: Context, imageUri: String, crop: Crop?): OcrResult {
    val started = System.nanoTime()
    val data = TessData.ensure(context)
    val bitmap = ImageLoader.load(context, imageUri, crop) // fails fast on an unreadable image, before the engine starts
    var api: TessBaseAPI? = null
    try {
      val engine: TessBaseAPI
      try {
        engine = TessBaseAPI() // inside the try: if the native library fails to load, the bitmap is still freed at once
        api = engine
        if (!engine.init(data.root.path, TessData.LANG, TessBaseAPI.OEM_LSTM_ONLY)) throw OcrException("ERR_OCR_ENGINE", "engine_init_failed")
        engine.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO)
        engine.setImage(bitmap) // copied into the engine's own buffer
      } finally {
        bitmap.recycle()
      }
      val lines = readLines(engine)
      return OcrResult(lines, (System.nanoTime() - started) / 1_000_000)
    } finally {
      api?.recycle() // frees the engine, the page image and the language data
    }
  }

  private fun readLines(api: TessBaseAPI): List<OcrLine> {
    val builder = LineBuilder()
    val it: ResultIterator = api.resultIterator ?: return emptyList() // null when nothing was recognised
    try {
      it.begin()
      do {
        val text = it.getUTF8Text(PageIteratorLevel.RIL_WORD) ?: ""
        val r = it.getBoundingRect(PageIteratorLevel.RIL_WORD)
        val word = OcrWord(text, it.confidence(PageIteratorLevel.RIL_WORD), Box(r.left, r.top, r.right, r.bottom))
        builder.add(word, it.isAtFinalElement(PageIteratorLevel.RIL_TEXTLINE, PageIteratorLevel.RIL_WORD))
      } while (it.next(PageIteratorLevel.RIL_WORD))
    } finally {
      it.delete()
    }
    return builder.lines()
  }
}
