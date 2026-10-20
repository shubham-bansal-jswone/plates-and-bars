package app.plateandbar.labelscan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LineBuilderTest {
  private fun w(text: String, conf: Float, l: Int, t: Int, r: Int, b: Int) = OcrWord(text, conf, Box(l, t, r, b))

  @Test fun `words up to the end of a line become one line with mean confidence and a union box`() {
    val b = LineBuilder()
    b.add(w("Protein", 90f, 10, 20, 80, 40), false)
    b.add(w("12.5g", 70f, 200, 22, 260, 42), true)
    b.add(w("Fat", 80f, 10, 60, 40, 80), true)
    val lines = b.lines()
    assertEquals(2, lines.size)
    assertEquals("Protein 12.5g", lines[0].text)
    assertEquals(80f, lines[0].confidence, 0.001f)
    assertEquals(Box(10, 20, 260, 42), lines[0].box)
    assertEquals(listOf("Protein", "12.5g"), lines[0].words.map { it.text })
    assertEquals("Fat", lines[1].text)
  }

  @Test fun `blank words are dropped and a line of only blanks is not reported`() {
    val b = LineBuilder()
    b.add(w("  ", 90f, 0, 0, 5, 5), false)
    b.add(w("", 90f, 0, 0, 5, 5), true)
    b.add(w(" Energy ", 88f, 0, 10, 50, 20), true)
    val lines = b.lines()
    assertEquals(listOf("Energy"), lines.map { it.text })
  }

  @Test fun `a last line that was not closed is still returned`() {
    val b = LineBuilder()
    b.add(w("Carbohydrate", 60f, 0, 0, 90, 10), false)
    assertEquals(listOf("Carbohydrate"), b.lines().map { it.text })
  }

  @Test fun `confidence is held to 0 to 100`() {
    val b = LineBuilder()
    b.add(w("a", -3f, 0, 0, 1, 1), false)
    b.add(w("b", 140f, 0, 0, 1, 1), true)
    val words = b.lines().single().words
    assertTrue(words.all { it.confidence in 0f..100f })
    assertEquals(50f, b.lines().single().confidence, 0.001f)
  }

  @Test fun `no words give no lines`() {
    assertEquals(0, LineBuilder().lines().size)
  }
}
